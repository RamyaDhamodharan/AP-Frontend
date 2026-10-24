import { useEffect, useState } from "react";
import {
  Gauge,
  LayoutDashboard,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScrollText,
  FileText,
  ClipboardList,
  PackageCheck,
  Users,
  Building2,
} from "lucide-react";

export type WorkspacePage = "dashboard" | "command-center" | "documents" | "invoices" | "purchase-orders" | "goods-receipts" | "vendors" | "email" | "associates" | "logs";

type Props = {
  activePage: WorkspacePage;
  isAdmin: boolean;
  documentCount: number;
  invoiceCount: number;
  emailAttentionCount: number;
  name: string;
  email: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onNavigate: (page: WorkspacePage) => void;
  onSignOut: () => void;
  signOutDisabled: boolean;
};

const iconProps = { size: 18, strokeWidth: 1.75, "aria-hidden": true as const };

export function Sidebar({
  activePage, isAdmin, documentCount, invoiceCount, emailAttentionCount, name, email,
  mobileOpen, onMobileClose, onNavigate, onSignOut, signOutDisabled,
}: Props) {
  const [userCollapsed, setUserCollapsed] = useState(() => {
    try { return window.localStorage.getItem("ap-sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia("(max-width: 1023px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrowScreen(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const collapsed = narrowScreen || userCollapsed;
  function toggleCollapsed() {
    const next = !userCollapsed;
    setUserCollapsed(next);
    try { window.localStorage.setItem("ap-sidebar-collapsed", String(next)); }
    catch { /* Storage may be unavailable; keep the current state in React. */ }
  }

  const items = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard {...iconProps}/> },
    ...(isAdmin ? [{ id: "logs", label: "Logs", icon: <ScrollText {...iconProps}/> }] : []),
    { id: "command-center", label: "Command Center", icon: <Gauge {...iconProps}/> },
    { id: "documents", label: "Documents", icon: <FileText {...iconProps}/>, count: documentCount },
    { id: "invoices", label: "Invoices", icon: <Receipt {...iconProps}/>, count: invoiceCount },
    { id: "purchase-orders", label: "Purchase Orders", icon: <ClipboardList {...iconProps}/> },
    { id: "goods-receipts", label: "Goods Receipts", icon: <PackageCheck {...iconProps}/> },
    ...(isAdmin ? [{ id: "vendors", label: "Vendors", icon: <Building2 {...iconProps}/> }] : []),
    { id: "email", label: "Email inbox", icon: <Mail {...iconProps}/>, count: emailAttentionCount },
    ...(isAdmin ? [{ id: "associates", label: "Associates", icon: <Users {...iconProps}/> }] : []),
  ] as const;

  return <aside className={`sidebar${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " sidebar-open" : ""}`}>
    <div className="sidebar-brand-row">
      <div className="brand"><span className="brand-mark">G</span><span className="sidebar-brand-copy">GENWORX<small>FINANCE AUTOMATION</small></span></div>
      <button type="button" className="sidebar-collapse-toggle" aria-label={collapsed ? "Expand workspace menu" : "Collapse workspace menu"} aria-expanded={!collapsed} onClick={toggleCollapsed} title={collapsed ? "Expand workspace menu" : "Collapse workspace menu"}>
        {collapsed ? <PanelLeftOpen {...iconProps}/> : <PanelLeftClose {...iconProps}/>}
      </button>
    </div>
    <p className="side-label">WORKSPACE</p>
    <nav className="primary-nav" aria-label="Main navigation">
      {items.map(item => <button type="button" key={item.id} className={`nav-item${activePage === item.id ? " nav-active" : ""}`} aria-label={`${item.label}${"count" in item && item.count ? `, ${item.count}` : ""}`} aria-current={activePage === item.id ? "page" : undefined} title={collapsed ? item.label : undefined} onClick={() => { onNavigate(item.id as WorkspacePage); onMobileClose(); }}>
        <span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span>
        {"count" in item && item.count !== undefined && item.count > 0 && <b className="nav-count">{collapsed ? <span className="nav-count-dot" aria-label={`${item.count} items`}/> : item.count}</b>}
      </button>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="profile"><span className="avatar" aria-hidden="true">{(email[0] || "U").toUpperCase()}</span><div className="sidebar-user-copy"><b>{name || email || "Workspace user"}</b><small>{email}</small></div></div>
      <button type="button" className="signout" onClick={onSignOut} disabled={signOutDisabled} aria-label="Sign out" title={collapsed ? "Sign out" : undefined}><LogOut {...iconProps}/><span className="nav-label">Sign out</span></button>
    </div>
  </aside>;
}
