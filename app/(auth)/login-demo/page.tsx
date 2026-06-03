import { AuthLoginPanel } from "../_components/auth-login-panel";

const QUICK_ACCOUNTS = [
  { label: "SuperAdmin 1", username: "SA-1", email: "sa-1@mail.com" },
  {
    label: "Admin A1",
    username: "admin-A1",
    email: "admin-a1@mail.shangjung.com",
  },
  {
    label: "Sales 1",
    username: "sales-1",
    email: "sales-1@mail.com",
  },
];

export default function LoginDemoPage() {
  return (
    <AuthLoginPanel
      title="Wafer Scheduling Auth (login-demo)"
      loginEndpoint="/api/auth/login-demo"
      postLogoutPath="/login-demo"
      initialUsername="SA-1"
      initialPassword="Password123!"
      quickAccounts={QUICK_ACCOUNTS}
    />
  );
}
