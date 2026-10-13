// Navigation menu: adapted from "Staggered Menu" by React Bits (reactbits.dev, David Haz,
// MIT + Commons Clause). Changes for this app: opens from the left behind a hamburger button,
// plain sans labels, a lighter and quicker animation (two colour layers, short stagger, no
// text roll), react-router links filtered by the user's permissions, an unseen-alerts badge,
// a footer with the signed-in user, and it closes on navigation, outside click or Esc.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { gsap } from 'gsap';
import './StaggeredMenu.css';

export default function StaggeredMenu({ colors = ['#f9c99f', '#e2611b'], items = [], footer = null, accentColor = '#e2611b' }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const panelRef = useRef(null);
  const layersRef = useRef(null);
  const btnRef = useRef(null);
  const tlRef = useRef(null);

  // Start with the panel and its colour layers off-screen to the left.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const layers = Array.from(layersRef.current.querySelectorAll('.sm-prelayer'));
      gsap.set([...layers, panelRef.current], { xPercent: -100 });
    });
    return () => ctx.revert();
  }, []);

  const animate = useCallback((opening) => {
    const panel = panelRef.current;
    const layers = Array.from(layersRef.current.querySelectorAll('.sm-prelayer'));
    const labels = Array.from(panel.querySelectorAll('.sm-item'));
    tlRef.current?.kill();
    const tl = gsap.timeline();
    if (opening) {
      gsap.set(labels, { x: -16, opacity: 0 });
      layers.forEach((el, i) => tl.to(el, { xPercent: 0, duration: 0.3, ease: 'power3.out' }, i * 0.05));
      tl.to(panel, { xPercent: 0, duration: 0.35, ease: 'power3.out' }, layers.length * 0.05);
      tl.to(labels, { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out', stagger: 0.035 }, layers.length * 0.05 + 0.1);
    } else {
      tl.to([panel, ...layers.reverse()], { xPercent: -100, duration: 0.22, ease: 'power2.in', stagger: 0.03 });
    }
    tlRef.current = tl;
  }, []);

  const setMenu = useCallback((target) => {
    if (openRef.current === target) return;
    openRef.current = target;
    setOpen(target);
    animate(target);
  }, [animate]);

  useEffect(() => { setMenu(false); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, setMenu]);

  return (
    <div className="sm-wrapper" style={{ '--sm-accent': accentColor }} data-open={open || undefined}>
      <div ref={layersRef} className="sm-prelayers" aria-hidden="true">
        {colors.slice(0, 2).map((c) => <div key={c} className="sm-prelayer" style={{ background: c }} />)}
      </div>
      <button ref={btnRef} type="button" className={`sm-burger ${open ? 'is-open' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open} aria-controls="sm-panel" onClick={() => setMenu(!openRef.current)}>
        <span /><span /><span />
      </button>
      <aside id="sm-panel" ref={panelRef} className="sm-panel" aria-hidden={!open}>
        <div className="sm-kicker">Pages</div>
        <ul className="sm-list">
          {items.map((it, i) => (
            <li key={it.to}>
              <Link className={`sm-item ${it.active ? 'is-active' : ''}`} to={it.to} tabIndex={open ? 0 : -1}>
                <span className="sm-num">{it.icon ? <it.icon size={16} /> : String(i + 1).padStart(2, '0')}</span>
                <span className="sm-text">
                  <span className="sm-label">{it.label}{it.badge ? <span className="sm-badge">{it.badge}</span> : null}</span>
                  {it.hint && <span className="sm-hint">{it.hint}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {footer && <div className="sm-footer">{footer}</div>}
      </aside>
    </div>
  );
}
