import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const AppShell = lazy(() => import("./components/AppShell").then((module) => ({ default: module.AppShell })));
const AuthPage = lazy(() => import("./pages/AuthPage").then((module) => ({ default: module.AuthPage })));
const RecoveryPage = lazy(() => import("./pages/AuthPage").then((module) => ({ default: module.RecoveryPage })));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage").then((module) => ({ default: module.AuthCallbackPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const TimelinePage = lazy(() => import("./pages/TimelinePage").then((module) => ({ default: module.TimelinePage })));
const SettingsPage = lazy(() => import("./pages/InfoPages").then((module) => ({ default: module.SettingsPage })));
const InvoicesPage = lazy(() => import("./pages/InvoicesPage").then((module) => ({ default: module.InvoicesPage })));
const LandingPage = lazy(() => import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage").then((module) => ({ default: module.ProjectDetailPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const ScopePage = lazy(() => import("./pages/ScopePage").then((module) => ({ default: module.ScopePage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const PublicFreelancerPage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.PublicFreelancerPage })));
const OpportunitiesPage = lazy(() => import("./pages/OpportunitiesPage").then((module) => ({ default: module.OpportunitiesPage })));
const ServicesPage = lazy(() => import("./pages/ServicesPage").then((module) => ({ default: module.ServicesPage })));
const MessagesPage = lazy(() => import("./pages/MessagesPage").then((module) => ({ default: module.MessagesPage })));
const HourlyWorkPage = lazy(() => import("./pages/HourlyWorkPage").then((module) => ({ default: module.HourlyWorkPage })));
const ModerationPage = lazy(() => import("./pages/ModerationPage").then((module) => ({ default: module.ModerationPage })));

export default function App() {
  return <Suspense fallback={<div className="route-loading" role="status">Loading ProofPay AI…</div>}><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/signin" element={<AuthPage mode="signin" />} />
    <Route path="/signup" element={<AuthPage mode="signup" />} />
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route path="/recover" element={<RecoveryPage />} />
    <Route path="/freelancers/:slug" element={<PublicFreelancerPage />} />
    <Route path="/app" element={<AppShell />}>
      <Route index element={<DashboardPage />} />
      <Route path="projects" element={<ProjectsPage />} />
      <Route path="projects/:projectId" element={<ProjectDetailPage />} />
      <Route path="projects/:projectId/hourly" element={<HourlyWorkPage />} />
      <Route path="moderation" element={<ModerationPage />} />
      <Route path="scope" element={<ScopePage />} />
      <Route path="invoices" element={<InvoicesPage />} />
      <Route path="analytics" element={<AnalyticsPage />} />
      <Route path="timeline" element={<TimelinePage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="opportunities" element={<OpportunitiesPage />} />
      <Route path="opportunities/:jobId" element={<OpportunitiesPage />} />
      <Route path="services" element={<ServicesPage />} />
      <Route path="messages" element={<MessagesPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
