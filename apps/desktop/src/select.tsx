import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

export type Option<T extends string> = { value: T; label: string; hint?: string };

// WAI-ARIA "select-only combobox": focus stays on the trigger, arrows move the highlight.
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const show = () => {
    setActive(Math.max(0, options.indexOf(current)));
    setOpen(true);
  };
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") return setOpen(false);
    if (!open) {
      if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) return;
      show();
    } else if (e.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter" || e.key === " ") pick(options[active].value);
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
    e.stopPropagation(); // keep the app's j/k/x/Esc shortcuts out of the menu
  };

  return (
    <div className="select" ref={root}>
      <button
        type="button"
        className="trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
      >
        {current.label}
        <CaretDown size={11} weight="bold" />
      </button>
      {open && (
        <ul className="menu" role="listbox" id={id} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? "active" : undefined}
              onPointerEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus on the trigger
              onClick={() => pick(o.value)}
            >
              <span>{o.label}</span>
              {o.hint && <span className="hint">{o.hint}</span>}
              <Check size={13} className="check" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
