import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(resolve(__dirname, '../../../docs/migrations/046_backend_yclients_client_binding.sql'), 'utf8');
describe('CRM migration security invariants (artifact only, never applied)', () => {
  it('pins company uniqueness and retains both ownership/evidence foreign keys', () => {
    expect(sql).toMatch(/primary key \(account_id, company_id\)/);
    expect(sql).toMatch(/unique \(company_id, client_id\)/);
    expect(sql).toContain('references backend_auth.accounts(id)');
    expect(sql).toContain('references backend_auth.contact_verification_challenges(challenge_id)');
    expect(sql).not.toMatch(/on conflict.*update|on delete cascade/i);
  });
  it('keeps contacts/proofs behind narrow definer read and binding immutable', () => {
    expect(sql).toContain('security definer\nset search_path=pg_catalog,pg_temp');
    expect(sql).toContain('revoke all on function backend_auth.read_crm_phone_proof(uuid) from public, backend_auth_app');
    expect(sql).not.toMatch(/grant.*(?:update|delete|truncate).*to backend_auth_app/i);
    expect(sql).not.toMatch(/grant.*on (?:table )?backend_auth.(?:account_contacts|contact_verification_challenges)/i);
    expect(sql).toContain('before update or delete');
    expect(sql).toContain('before truncate');
  });
  it('fences every profile edit and locks current verified evidence before saving', () => {
    expect(sql).toContain('NEW.phone is distinct from OLD.phone');
    expect(sql).toContain('OLD.crm_phone_revision + 1');
    expect(sql).toContain('NEW.crm_phone_revision := OLD.crm_phone_revision');
    expect(sql).toContain('h.created_at > p.crm_phone_changed_at');
    expect(sql).toContain("h.method='phone_sms_otp' and h.purpose='contact_ownership' and h.state='verified'");
    expect(sql).toContain('for share of c,h');
    expect(sql).toContain("role='player' and status='active' for share");
  });
});
