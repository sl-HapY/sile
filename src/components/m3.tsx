import React, { useRef, useState, useCallback, useEffect } from "react";
import { X, AlertCircle, CheckCircle2, Info, ChevronDown, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Ripple helper
// ---------------------------------------------------------------------------

export function useRipple() {
  const ref = useRef<HTMLElement | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ink = document.createElement("span");
    ink.className = "ripple-ink";
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${e.clientX - rect.left - size / 2}px`;
    ink.style.top = `${e.clientY - rect.top - size / 2}px`;
    el.appendChild(ink);
    setTimeout(() => ink.remove(), 520);
  }, []);
  return { ref, onPointerDown };
}

// ---------------------------------------------------------------------------
// Icon button
// ---------------------------------------------------------------------------

export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    filled?: boolean;
    tonal?: boolean;
    danger?: boolean;
    active?: boolean;
  }
>(function IconButton({ className = "", filled, tonal, danger, active, ...rest }, fwd) {
  const { ref: rref, onPointerDown } = useRipple();
  return (
    <button
      ref={(el) => {
        (rref as any).current = el;
        if (typeof fwd === "function") fwd(el);
        else if (fwd) (fwd as any).current = el;
      }}
      className={`icon-btn ${filled ? "filled" : ""} ${tonal ? "tonal" : ""} ${
        danger ? "danger" : ""
      } ${active ? "active" : ""} ${className}`}
      onPointerDown={onPointerDown}
      {...rest}
    />
  );
});

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function M3Button({
  variant = "filled",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "filled" | "tonal" | "outlined" | "text" | "danger";
}) {
  const { ref, onPointerDown } = useRipple();
  return (
    <button
      ref={ref as any}
      onPointerDown={onPointerDown}
      className={`m3-btn ${variant} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Text field
// ---------------------------------------------------------------------------

export function TextField({
  label,
  icon,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={`m3-field ${className}`}>
      {label && <label>{label}</label>}
      <div className="field-box">
        {icon}
        <input {...rest} />
      </div>
    </div>
  );
}

export function SelectField({
  label,
  icon,
  children,
  className = "",
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={`m3-field ${className}`}>
      {label && <label>{label}</label>}
      <div className="field-box">
        {icon}
        <select {...rest}>{children}</select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={`m3-switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <div className="knob" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={`m3-check ${checked ? "checked" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  icon,
  title,
  children,
  actions,
  onClose,
  width,
  className = "",
  dismissable = true,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  width?: number | string;
  className?: string;
  dismissable?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable && onClose) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, dismissable]);

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable && onClose) onClose();
      }}
    >
      <div className={`m3-dialog ${className}`} style={width ? { width } : undefined}>
        <div className="dlg-head">
          {icon && <div className="dlg-icon">{icon}</div>}
          <div className="dlg-title">{title}</div>
          {onClose && dismissable && (
            <IconButton onClick={onClose} aria-label="Close">
              <X size={18} />
            </IconButton>
          )}
        </div>
        <div className="dlg-body">{children}</div>
        {actions && <div className="dlg-actions">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu (portal-free, fixed positioned)
// ---------------------------------------------------------------------------

export interface MenuItemDef {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  sectionLabel?: string;
  selected?: boolean;
  onClick?: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItemDef[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      let nx = x;
      let ny = y;
      if (x + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
      if (y + r.height > window.innerHeight - 8) ny = window.innerHeight - r.height - 8;
      setPos({ x: Math.max(4, nx), y: Math.max(4, ny) });
    }
  }, [x, y]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      // clicks inside the menu belong to its items — never close on them,
      // otherwise the menu unmounts before the item's onClick fires
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest(".m3-menu")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // defer so the opening click doesn't immediately close
    const t = setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("wheel", close);
    }, 0);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div className="m3-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it.separator ? (
          <div className="menu-sep" key={i} />
        ) : it.sectionLabel ? (
          <div className="menu-label" key={i}>
            {it.sectionLabel}
          </div>
        ) : (
          <button
            className="menu-item"
            key={i}
            disabled={it.disabled}
            style={it.danger ? { color: "var(--error)" } : undefined}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon}
            {it.label}
            {it.selected ? (
              <span className="shortcut" style={{ color: "var(--primary)" }}>
                <Check size={14} />
              </span>
            ) : (
              it.shortcut && <span className="shortcut">{it.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// M3Select — custom dropdown replacing native <select>
// ---------------------------------------------------------------------------

export function M3Select({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`m3-select ${className}`}
        onClick={() => {
          if (open) {
            setOpen(null);
            return;
          }
          const r = btnRef.current!.getBoundingClientRect();
          setOpen({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown size={14} className={open ? "rot" : ""} />
      </button>
      {open && (
        <ContextMenu
          x={open.x}
          y={open.y}
          items={options.map((o) => ({
            label: o.label,
            selected: o.value === value,
            onClick: () => onChange(o.value),
          }))}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Snackbar host
// ---------------------------------------------------------------------------

export function ToastHost({ toasts }: { toasts: { id: number; msg: string; kind: string }[] }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`m3-snackbar ${t.kind}`}>
          {t.kind === "error" ? (
            <AlertCircle size={16} />
          ) : t.kind === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <Info size={16} />
          )}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linear progress
// ---------------------------------------------------------------------------

export function LinearProgress({
  value,
  indeterminate,
}: {
  value?: number;
  indeterminate?: boolean;
}) {
  return (
    <div className={`m3-linear ${indeterminate ? "indeterminate" : ""}`}>
      <div
        className="bar"
        style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function Tooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      {React.cloneElement(children, {
        onPointerEnter: (e: React.PointerEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
        },
        onPointerLeave: () => setPos(null),
      } as any)}
      {pos && (
        <div
          className="m3-tooltip"
          style={{ left: pos.x, top: pos.y, transform: "translateX(-50%)" }}
        >
          {label}
        </div>
      )}
    </>
  );
}
