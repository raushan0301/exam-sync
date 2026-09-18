export * from './auth.module';
// Mirrors auth.module.ts's own `exports: [...]` array — see the same note
// in academic-structure/index.ts.
export { AuthService } from './auth.service';
export { PasswordService } from './password.service';
