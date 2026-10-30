import React, { useEffect, useRef, useState } from "react";
import {
  PlugZap, Settings2, Sun, Moon, Loader2, Unlink, Search,
  Command, Globe, Star, Server,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { IconButton, ContextMenu, MenuItemDef, M3Select } from "./m3";

export function Toolbar() {
  const st = useStore();
  const [proto, setProto] = useState("sftp");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("root");
  const [pass, setPass] = useState("");
  const [port, setPort] = useState("");
  const [sitesMenu, setSitesMenu] = useState<{ x: number; y: number } | null>(null);

  const quickConnect = () => {
    if (!host.trim()) return;
    st.connectSite({
      name: host.trim(),
      protocol: proto,
      host: host.trim(),
      port: port ? parseInt(port) : 0,
      username: user.trim() || "root",
      password: pass,
      remote_start: "/",
    } as any);
  };

  const quickOpenSite = async (siteId: string) => {
    const site = st.sites.find((s) => s.id === siteId);
    if (!site) return;
    if (site.has_password) {
      try {
        const password = await api.siteGetPassword(site.id);
        await st.connectSite({
          id: site.id,
          name: site.name,
          protocol: site.protocol,
          host: site.host,
          port: site.port,
          username: site.username || "root",
          password,
          remote_start: site.remote_start || "/",
          local_start: site.local_start || "",
        } as any);
        return;
      } catch (e: any) {
        st.toast(`Stored password failed: ${e}`, "error");
      }
    }
    st.openModal("sites");
  };

  const siteItems: MenuItemDef[] = st.sites.length
    ? [
        { sectionLabel: "Saved sites — click to connect" },
        ...st.sites.map((s) => ({
          label: `${s.name}  (${s.protocol.toUpperCase()} · ${s.host})`,
          icon: <Server size={15} />,
          onClick: () => quickOpenSite(s.id),
        })),
        { separator: true },
        { label: "Manage sites...", icon: <Globe size={15} />, onClick: () => st.openModal("sites") },
      ]
    : [
        { sectionLabel: "No saved sites yet" },
        { label: "Open Site Manager", icon: <Globe size={15} />, onClick: () => st.openModal("sites") },
      ];

  return (
    <div className="toolbar">
      <M3Select
        value={proto}
        options={[
          { value: "sftp", label: "SFTP" },
          { value: "ftps", label: "FTPS" },
          { value: "ftp", label: "FTP" },
        ]}
        onChange={setProto}
        className="qc-proto"
      />
      <input
        className="qc-input"
        placeholder="host.example.com"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && quickConnect()}
        style={{ width: 170 }}
      />
      <input
        className="qc-input"
        placeholder="root"
        value={user}
        onChange={(e) => setUser(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && quickConnect()}
        style={{ width: 110 }}
      />
      <input
        className="qc-input"
        placeholder="password"
        type="password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && quickConnect()}
        style={{ width: 110 }}
      />
      <input
        className="qc-input"
        placeholder="port"
        value={port}
        onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && quickConnect()}
        style={{ width: 56 }}
      />
      <button
        className="m3-btn filled"
        style={{ height: 34, padding: "0 16px" }}
        onClick={quickConnect}
        disabled={st.connecting || !host.trim()}
      >
        {st.connecting ? <Loader2 size={15} className="spin" /> : <PlugZap size={15} />}
        Quick Connect
      </button>
      {st.session && (
        <button
          className="m3-btn outlined"
          style={{ height: 34, padding: "0 14px" }}
          onClick={() => st.disconnect()}
          title="Disconnect"
        >
          <Unlink size={15} />
          Disconnect
        </button>
      )}
      <div className="spacer" />
      <IconButton onClick={(e: any) => setSitesMenu({ x: e.clientX, y: e.clientY })} title="Saved sites — quick connect">
        <Star size={17} />
      </IconButton>
      <IconButton
        onClick={() => {
          if (!st.session) {
            st.toast("Connect to a server first", "error");
            return;
          }
          st.openModal("search", { side: "remote" });
        }}
        title="Search remote"
      >
        <Search size={17} />
      </IconButton>
      <IconButton onClick={() => st.openModal("palette")} title="Command palette (Ctrl+K)">
        <Command size={17} />
      </IconButton>
      <IconButton onClick={st.toggleTheme} title="Toggle theme">
        {st.theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
      </IconButton>
      <IconButton onClick={() => st.openModal("settings")} title="Settings">
        <Settings2 size={17} />
      </IconButton>
      {sitesMenu && (
        <ContextMenu
          x={sitesMenu.x}
          y={sitesMenu.y}
          items={siteItems}
          onClose={() => setSitesMenu(null)}
        />
      )}
    </div>
  );
}
