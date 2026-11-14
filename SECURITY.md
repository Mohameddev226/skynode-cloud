# SkyNode Cloud — Security

## Security Model

### Authentication

- **Platform auth**: Argon2id password hashing, HttpOnly/Secure/SameSite=Lax cookies
- **Application auth**: Argon2id + JWT (15min expiry) + secure refresh tokens
- **CSRF protection** on all state-changing dashboard endpoints
- **Rate limiting**: 5 login attempts/min per IP, exponential backoff
- **Account lockout**: 10 failed attempts triggers temporary lock

### Database Security

- **Isolation**: Separate PostgreSQL database per project
- **Least privilege**: Dedicated roles with minimal permissions
- **RLS**: Row-Level Security enforced on all project API access
- **Connection separation**: Admin role (DDL) vs app role (DML, RLS-enforced)
- **Provisioner isolation**: CREATEDB/CREATEROLE role never used at runtime
- **Query safety**: SQL Editor runs through project-scoped role with statement timeout

### API Security

- **Helmet**: HTTP security headers on all responses
- **CORS**: Strict origin validation
- **Input validation**: Zod schemas + class-validator on all endpoints
- **Key hashing**: API keys hashed with SHA-256 before storage
- **No secret exposure**: Secret keys never sent to browser clients

### Infrastructure Security

- **Internal networking**: PostgreSQL, Redis, MinIO on private Docker network
- **No public DB exposure**: PostgreSQL ports closed in production
- **TLS termination**: Nginx handles HTTPS with TLS 1.2/1.3
- **Backup encryption**: All backups encrypted at rest
- **Audit logging**: All privileged operations recorded with immutable logs

### Identified Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| SQL Injection via SQL Editor | Critical | Project-scoped role, statement timeout, blocked admin ops |
| Cross-project data leakage | Critical | Separate databases, dedicated roles per project |
| Privilege escalation | Critical | Provisioner never used at runtime, env-only credentials |
| Session hijacking | High | HttpOnly + Secure + SameSite cookies, session rotation |
| API key compromise | High | SHA-256 hashed storage, rotation support |
| Brute force login | High | Rate limiting, account lockout, exponential backoff |

### Security Practices

- No passwords, tokens, or secrets in logs
- No stack traces in production error responses
- Environment variables for all secrets
- Development secrets must not reach production
- Regular security reviews scheduled per phase
