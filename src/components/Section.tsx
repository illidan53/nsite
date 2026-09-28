import { useId, useState, type ReactNode } from 'react';

interface Props {
  title: ReactNode;
  aside?: ReactNode;
  /** 用于记住展开状态的 localStorage 键。 */
  storageKey: string;
  defaultOpen: boolean;
  children: ReactNode;
}

function readOpen(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/** 面板里可展开 / 收起的一段。 */
export default function Section({ title, aside, storageKey, defaultOpen, children }: Props) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const id = useId();
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(storageKey, open ? '0' : '1');
    } catch {
      // 忽略
    }
  };
  return (
    <section className={`section ${open ? 'section-open' : ''}`}>
      <div className="section-head">
        <button className="section-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>
          <span className="section-chevron" aria-hidden="true" />
          <span className="section-title">{title}</span>
        </button>
        {aside && <span className="section-aside">{aside}</span>}
      </div>
      <div id={id} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
