import React, { useEffect, useState } from "react";
import {
  Globe, Server, Plus, Pencil, Trash2, Save, FolderHeart,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { SiteView } from "../lib/types";
import { Dialog, IconButton, M3Button, TextField, SelectField } from "./m3";

interface Draft {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: string;
  username: string;
  password: string;
  remote_start: string;
  local_start: string;
}

const emptyDraft = (): Draft => ({
  id: "",
  name: "",
  protocol: "sftp",
  host: "",
  port: "",
  username: "root",
  password: "",
  remote_start: "/",
  local_start: "",
});

export function SiteManager() {
  const st = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editing, setEditing] = useState(false);

  const select = (s: SiteView) => {
    setSelected(s.id);
    setEditing(true);
    setDraft({
      id: s.id,
      name: s.name,
      protocol: s.protocol,
      host: s.host,
      port: s.port ? String(s.port) : "",
      username: s.username,
      password: "",
      remote_start: s.remote_start || "/",
      local_start: s.local_start || "",
    });
  };

  const save = async () => {
    if (!draft.host.trim()) {
      st.toast("Host is required", "error");
      return;
    }
    try {
      await api.siteSave({
        id: draft.id,
        name: draft.name.trim() || draft.host.trim(),
        protocol: draft.protocol as any,
        host: draft.host.trim(),
        port: draft.port ? parseInt(draft.port) : 0,
        username: draft.username,
        password: draft.password,
        remote_start: draft.remote_start || "/",
        local_start: draft.local_start,
        accept_invalid_certs: false,
        color: "",
      });
      await st.loadSites();
      st.toast("Site saved", "success");
      setEditing(false);
      setSelected(null);
      setDraft(emptyDraft());
    } catch (e: any) {
      st.toast(`Save failed: ${e}`, "error");
    }
  };

  const del = async () => {
    if (!selected) return;
    await api.siteDelete(selected);
    await st.loadSites();
    setSelected(null);
    setEditing(false);
    setDraft(emptyDraft());
    st.toast("Site deleted");
  };

  const connect = async () => {
    const site = st.sites.find((s) => s.id === selected);
    if (!site) return;
    if (site.has_password) {
      // stored password — connect immediately, no prompt
      try {
        const password = await api.siteGetPassword(site.id);
        st.closeModal();
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
    st.openModal("password", { site, draft });
  };

  return (
    <Dialog
      icon={<Globe size={19} />}
      title="Site Manager"
      width={760}
      onClose={() => st.closeModal()}
      actions={
        <>
          <M3Button variant="text" onClick={() => st.closeModal()}>
            Close
          </M3Button>
          {selected && (
            <M3Button variant="outlined" onClick={del}>
              <Trash2 size={15} /> Delete
            </M3Button>
          )}
          {selected && (
            <M3Button variant="tonal" onClick={connect}>
              Connect
            </M3Button>
          )}
        </>
      }
    >
      <div className="site-layout">
        <div className="site-list-col">
          <M3Button
            variant="tonal"
            style={{ justifyContent: "center" }}
            onClick={() => {
              setSelected(null);
              setEditing(true);
              setDraft(emptyDraft());
            }}
          >
            <Plus size={15} /> New site
          </M3Button>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {st.sites.map((s) => (
              <div
                key={s.id}
                className={`site-item ${selected === s.id ? "selected" : ""}`}
                onClick={() => select(s)}
                onDoubleClick={() => connect()}
              >
                <div className="sicon">
                  <Server size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="sname">{s.name}</div>
                  <div className="shost">
                    {s.protocol.toUpperCase()} · {s.host}
                  </div>
                </div>
              </div>
            ))}
            {st.sites.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: "var(--on-surface-variant)", textAlign: "center" }}>
                No saved sites yet.<br />Create one or use Quick Connect.
              </div>
            )}
          </div>
        </div>

        {editing ? (
          <div className="site-form">
            <div className="form-row">
              <TextField
                label="Site name"
                placeholder="My server"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <SelectField
                label="Protocol"
                value={draft.protocol}
                onChange={(e) => setDraft({ ...draft, protocol: e.target.value })}
              >
                <option value="sftp">SFTP (SSH File Transfer)</option>
                <option value="ftps">FTPS (FTP over TLS)</option>
                <option value="ftp">FTP (plain)</option>
              </SelectField>
            </div>
            <div className="form-row">
              <TextField
                label="Host"
                placeholder="example.com"
                value={draft.host}
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              />
              <TextField
                label="Port (empty = default)"
                placeholder={draft.protocol === "sftp" ? "22" : "21"}
                value={draft.port}
                onChange={(e) => setDraft({ ...draft, port: e.target.value.replace(/\D/g, "") })}
              />
            </div>
            <div className="form-row">
              <TextField
                label="Username"
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
              <TextField
                label={draft.id ? "Password (empty = keep)" : "Password"}
                type="password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </div>
            <div className="form-row">
              <TextField
                label="Default remote directory"
                placeholder="/"
                value={draft.remote_start}
                onChange={(e) => setDraft({ ...draft, remote_start: e.target.value })}
              />
              <TextField
                label="Default local directory"
                placeholder="optional"
                value={draft.local_start}
                onChange={(e) => setDraft({ ...draft, local_start: e.target.value })}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <M3Button onClick={save} disabled={!draft.host.trim()}>
                <Save size={15} /> Save site
              </M3Button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--on-surface-variant)", display: "flex", gap: 6, alignItems: "center" }}>
              <FolderHeart size={13} />
              Passwords are encrypted with AES-256-GCM before being stored on disk.
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <Server size={38} />
            <div>Select a site or create a new one</div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function PasswordPrompt() {
  const st = useStore();
  const payload = st.modal?.payload as
    | { site: SiteView; draft: Draft }
    | undefined;
  const [pass, setPass] = useState("");

  if (!payload) return null;
  const { site, draft } = payload;

  const go = async () => {
    st.closeModal();
    await st.connectSite({
      id: site.id,
      name: site.name,
      protocol: site.protocol,
      host: site.host,
      port: site.port,
      username: site.username,
      password: pass,
      remote_start: site.remote_start || draft.remote_start || "/",
      local_start: site.local_start || draft.local_start || "",
    } as any);
  };

  return (
    <Dialog
      icon={<Server size={19} />}
      title={`Connect to ${site.name}`}
      onClose={() => st.closeModal()}
      actions={
        <>
          <M3Button variant="text" onClick={() => st.closeModal()}>
            Cancel
          </M3Button>
          <M3Button onClick={go}>Connect</M3Button>
        </>
      }
    >
      <p style={{ marginTop: 4 }}>
        {site.protocol.toUpperCase()} · {site.host}:{site.port || (site.protocol === "sftp" ? 22 : 21)} · {site.username}
      </p>
      <TextField
        label="Password"
        type="password"
        autoFocus
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
    </Dialog>
  );
}
