import { createBrowserRouter, Outlet } from "react-router";
import { LoginPage } from "./components/LoginPage";
import { AdminDashboard } from "./components/AdminDashboard";
import { PostVoteDashboard } from "./components/PostVoteDashboard";
import { PreVoteLaunchpad } from "./components/PreVoteLaunchpad";
import { SecureTunnel } from "./components/SecureTunnel";
import { BallotPage } from "./components/BallotPage";
import { SubmissionShield } from "./components/SubmissionShield";
import { SuccessPage } from "./components/SuccessPage";
import { WelcomeBriefing } from "./components/WelcomeBriefing";

function RootLayout() {
  return (
    <Outlet />
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: LoginPage },
      { path: "welcome", Component: WelcomeBriefing },
      { path: "admin", Component: AdminDashboard },
      { path: "launchpad", Component: PreVoteLaunchpad },
      { path: "dashboard", Component: PostVoteDashboard },
      { path: "tunnel", Component: SecureTunnel },
      { path: "ballot", Component: BallotPage },
      { path: "submitting", Component: SubmissionShield },
      { path: "success", Component: SuccessPage },
    ]
  }
]);
