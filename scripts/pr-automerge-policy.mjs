const STAFF_PERMISSIONS = new Set(['admin', 'maintain', 'write', 'triage']);
const STAFF_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function normalizedLogin(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function evaluateAutoMergeAuthor({
  author,
  permission,
  association,
  trustedStudents = [],
}) {
  const login = normalizedLogin(author);
  if (!login) return { allowed: false, kind: 'unknown', reason: 'missing author login' };

  const permissionName = String(permission ?? '').toLowerCase();
  const associationName = String(association ?? '').toUpperCase();
  if (STAFF_PERMISSIONS.has(permissionName) || STAFF_ASSOCIATIONS.has(associationName)) {
    return { allowed: true, kind: 'operator', reason: `trusted ${permissionName || associationName}` };
  }

  const studentLogins = new Set(trustedStudents.map(normalizedLogin).filter(Boolean));
  if (studentLogins.has(login)) {
    return { allowed: true, kind: 'student', reason: 'registered student' };
  }

  return {
    allowed: false,
    kind: 'external',
    reason: 'public read access is not trusted student membership',
  };
}
