import { useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import Reports from "@/pages/Reports";
import ReportNew from "@/pages/ReportNew";
import ReportDetail from "@/pages/ReportDetail";
import Inventory from "@/pages/Inventory";
import Issues from "@/pages/Issues";
import Tasks from "@/pages/Tasks";
import Invoices from "@/pages/Invoices";
import Documents from "@/pages/Documents";
import Assistant from "@/pages/Assistant";
import Analytics from "@/pages/Analytics";
import Team from "@/pages/Team";
import NotFound from "@/pages/NotFound";
import { BrandMark } from "@/components/layout/Sidebar";

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-brand-950">
      <BrandMark />
      <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-400" />
      </div>
      <p className="text-xs text-white/40">Checking your session…</p>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [ready] = useState(true);

  if (loading || !ready) return <Splash />;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login onSuccess={() => navigate("/", { replace: true })} />}
      />
      <Route
        element={
          user ? (
            <AppShell />
          ) : (
            <Navigate
              to="/login"
              replace
            />
          )
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/new" element={<ReportNew />} />
        <Route path="/reports/:id" element={<ReportDetail />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/issues" element={<Issues />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/team" element={<Team />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
