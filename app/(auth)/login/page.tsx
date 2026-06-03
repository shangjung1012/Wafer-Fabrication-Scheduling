import { AuthLoginPanel } from "../_components/auth-login-panel";

export default function LoginPage() {
  return (
    <AuthLoginPanel
      title="Wafer Scheduling Auth"
      loginEndpoint="/api/auth/login"
      postLogoutPath="/login"
    />
  );
}
