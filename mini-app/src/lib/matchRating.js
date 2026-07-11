export function isRatingMatch(match) {
  if (!match) return false;

  const ratingMode = String(match.ratingMode ?? match.rating_mode ?? '').toLowerCase();

  return (
    match.isRatingMatch === true ||
    match.is_rating_match === true ||
    match.affectsRating === true ||
    match.affects_rating === true ||
    ratingMode === 'rating' ||
    ratingMode === 'rated'
  );
}

export function requiresVerifiedRating(match) {
  return (
    isRatingMatch(match) ||
    match?.requiresVerifiedRating === true ||
    match?.requires_verified_rating === true
  );
}
