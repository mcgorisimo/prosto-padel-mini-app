import { createHash } from 'node:crypto';
import ts from 'typescript';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue).sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      if (leftJson < rightJson) return -1;
      if (leftJson > rightJson) return 1;
      return 0;
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

export function stableJsonDigest(value) {
  return sha256(JSON.stringify(stableJsonValue(value)));
}

function omitKnipByteOffsets(value) {
  if (Array.isArray(value)) return value.map(omitKnipByteOffsets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'pos')
        .map(([key, nestedValue]) => [key, omitKnipByteOffsets(nestedValue)]),
    );
  }
  return value;
}

export function stableKnipDigest(report) {
  return stableJsonDigest(omitKnipByteOffsets(report));
}

function knipFindingLabel(finding) {
  if (typeof finding === 'string') return finding;
  if (!finding || typeof finding !== 'object') return String(finding);
  if (typeof finding.name === 'string') return finding.name;
  return JSON.stringify(omitKnipByteOffsets(finding));
}

function knipFindingLocation(filePath, finding) {
  if (!finding || typeof finding !== 'object' || !finding.line) {
    return filePath;
  }
  return `${filePath}:${finding.line}:${finding.col ?? 1}`;
}

function appendKnipFinding(lines, filePath, category, value, parents = []) {
  if (Array.isArray(value)) {
    for (const nestedValue of value) {
      appendKnipFinding(lines, filePath, category, nestedValue, parents);
    }
    return;
  }
  if (
    value &&
    typeof value === 'object' &&
    (typeof value.name === 'string' || typeof value.line === 'number')
  ) {
    const parentLabel = parents.length > 0 ? ` ${parents.join('.')}` : '';
    lines.push(
      `${knipFindingLocation(filePath, value)}: ${category}${parentLabel}: ` +
        knipFindingLabel(value),
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const [parentName, nestedValue] of Object.entries(value)) {
      appendKnipFinding(
        lines,
        filePath,
        category,
        nestedValue,
        parents.concat(parentName),
      );
    }
    return;
  }
  if (value !== undefined && value !== null) {
    const parentLabel = parents.length > 0 ? ` ${parents.join('.')}` : '';
    lines.push(`${filePath}: ${category}${parentLabel}: ${String(value)}`);
  }
}

export function formatKnipFindings(report) {
  const lines = (report.files ?? []).map(
    (filePath) => `${filePath}: unused file`,
  );
  for (const issue of report.issues ?? []) {
    for (const [category, findings] of Object.entries(issue)) {
      if (category === 'file') continue;
      appendKnipFinding(lines, issue.file, category, findings);
    }
  }
  return lines.sort().join('\n');
}

export function findUnexpectedHashedViolations({
  actualHashes,
  baselineHashes,
}) {
  return Object.entries(actualHashes)
    .filter(([path, hash]) => baselineHashes[path] !== hash)
    .map(([path]) => path)
    .sort();
}

export function isRestrictedImportSource(filePath) {
  return /\.(?:[cm]?[jt]sx?)$/.test(filePath);
}

function isRestrictedModuleSpecifier(specifier) {
  return /(?:^|\/)supabaseClient(?:\.(?:[cm]?[jt]sx?))?(?:[?#].*)?$/.test(
    specifier,
  );
}

function scriptKind(filePath) {
  if (/\.tsx$/.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.(?:ts|mts|cts)$/.test(filePath)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(filePath)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function staticStringValue(node) {
  if (ts.isLiteralTypeNode(node)) {
    return staticStringValue(node.literal);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isParenthesizedExpression(node)) {
    return staticStringValue(node.expression);
  }
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return staticStringValue(node.expression);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = staticStringValue(span.expression);
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }
  return null;
}

function unwrapTransparentExpression(node) {
  let expression = node;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isUnshadowedCommonJsIdentifier(identifier, checker, sourceFile) {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol) return true;
  return !(symbol.declarations ?? []).some(
    (declaration) =>
      declaration.getSourceFile() === sourceFile &&
      !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient),
  );
}

function isRequireCall(expression, checker, sourceFile) {
  const callee = unwrapTransparentExpression(expression);
  if (ts.isIdentifier(callee)) {
    return (
      callee.text === 'require' &&
      isUnshadowedCommonJsIdentifier(callee, checker, sourceFile)
    );
  }

  if (
    !ts.isPropertyAccessExpression(callee) &&
    !ts.isElementAccessExpression(callee)
  ) {
    return false;
  }
  const receiver = unwrapTransparentExpression(callee.expression);
  if (
    !ts.isIdentifier(receiver) ||
    receiver.text !== 'module' ||
    !isUnshadowedCommonJsIdentifier(receiver, checker, sourceFile)
  ) {
    return false;
  }
  const propertyName = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : staticStringValue(callee.argumentExpression);
  return propertyName === 'require';
}

function createRestrictedImportProgram(files) {
  const options = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const virtualFiles = new Map(
    files.map((file, index) => [
      `/quality/${index}/${file.path.replaceAll('\\', '/')}`,
      file,
    ]),
  );
  const host = ts.createCompilerHost(options, true);
  host.fileExists = (fileName) => virtualFiles.has(fileName);
  host.readFile = (fileName) => virtualFiles.get(fileName)?.content;
  host.getSourceFile = (fileName, languageVersion) => {
    const file = virtualFiles.get(fileName);
    return file
      ? ts.createSourceFile(
          fileName,
          file.content,
          languageVersion,
          true,
          scriptKind(file.path),
        )
      : undefined;
  };
  const program = ts.createProgram({
    rootNames: [...virtualFiles.keys()],
    options,
    host,
  });
  return { program, virtualFiles };
}

export function collectRestrictedImports(files) {
  const imports = [];
  const { program, virtualFiles } = createRestrictedImportProgram(files);
  const checker = program.getTypeChecker();
  for (const [virtualPath, file] of virtualFiles) {
    const sourceFile = program.getSourceFile(virtualPath);
    if (!sourceFile) continue;
    const recordSpecifier = (node) => {
      const specifier = staticStringValue(node);
      if (specifier !== null && isRestrictedModuleSpecifier(specifier)) {
        imports.push(`${file.path}::${specifier}`);
      }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) recordSpecifier(node.moduleSpecifier);
      } else if (ts.isImportTypeNode(node)) {
        recordSpecifier(node.argument);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression
      ) {
        recordSpecifier(node.moduleReference.expression);
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0 &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          isRequireCall(node.expression, checker, sourceFile))
      ) {
        recordSpecifier(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return imports.sort();
}
