// Navigation menu: adapted from "Staggered Menu" by React Bits (reactbits.dev, David Haz,
// MIT + Commons Clause). Changes for this app: items are react-router links filtered by the
// user's permissions, an optional badge per item (unseen alerts), a footer slot for the
// signed-in user instead of social links, no logo in the menu header (the top bar has it),
// and the menu closes on navigation.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { gsap } from 'gsap';
import './StaggeredMenu.css';

export default function StaggeredMenu({
  position = 'right',
  colors = ['#f9c99f', '#e2611b'],
  items = [],
  footer = null,
  accentColor = '#e2611b',
  menuButtonColor = '#2b2118',
  openMenuButtonColor = '#2b2118',
  displayItemNumbering = true,
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const panelRef = useRef(null);
  const preLayersRef = useRef(null);
  const preLayerElsRef = useRef([]);
  const plusHRef = useRef(null);
  const plusVRef = useRef(null);
  const iconRef = useRef(null);
  const textInnerRef = useRef(null);
  const toggleBtnRef = useRef(null);
  const [textLines, setTextLines] = useState(['Menu', 'Close']);
  const openTlRef = useRef(null);
  const closeTweenRef = useRef(null);
  const spinTweenRef = useRef(null);
  const textCycleAnimRef = useRef(null);
  const colorTweenRef = useRef(null);
  const busyRef = useRef(false);

  // Initial off-screen state for the panel and the coloured layers behind it.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const panel = panelRef.current;
      const preLayers = preLayersRef.current ? Array.from(preLayersRef.current.querySelectorAll('.sm-prelayer')) : [];
      preLayerElsRef.current = preLayers;
      const offscreen = position === 'left' ? -100 : 100;
      gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
      gsap.set(preLayersRef.current, { xPercent: 0, opacity: 1 });
      gsap.set(plusHRef.current, { transformOrigin: '50% 50%', rotate: 0 });
      gsap.set(plusVRef.current, { transformOrigin: '50% 50%', rotate: 90 });
      gsap.set(iconRef.current, { rotate: 0, transformOrigin: '50% 50%' });
      gsap.set(textInnerRef.current, { yPercent: 0 });
      gsap.set(toggleBtnRef.current, { color: menuButtonColor });
    });
    return () => ctx.revert();
  }, [menuButtonColor, position]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;
    openTlRef.current?.kill();
    closeTweenRef.current?.kill();

    const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'));
    const numberEls = Array.from(panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item'));
    const footerEls = Array.from(panel.querySelectorAll('.sm-footer > *'));
    const offscreen = position === 'left' ? -100 : 100;

    gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    gsap.set(numberEls, { '--sm-num-opacity': 0 });
    gsap.set(footerEls, { y: 20, opacity: 0 });

    const tl = gsap.timeline({ paused: true });
    layers.forEach((el, i) => tl.fromTo(el, { xPercent: offscreen }, { xPercent: 0, duration: 0.5, ease: 'power4.out' }, i * 0.07));
    const panelAt = (layers.length ? (layers.length - 1) * 0.07 : 0) + (layers.length ? 0.08 : 0);
    tl.fromTo(panel, { xPercent: offscreen }, { xPercent: 0, duration: 0.65, ease: 'power4.out' }, panelAt);
    const itemsAt = panelAt + 0.65 * 0.15;
    tl.to(itemEls, { yPercent: 0, rotate: 0, duration: 1, ease: 'power4.out', stagger: { each: 0.08, from: 'start' } }, itemsAt);
    tl.to(numberEls, { duration: 0.6, ease: 'power2.out', '--sm-num-opacity': 1, stagger: { each: 0.08, from: 'start' } }, itemsAt + 0.1);
    tl.to(footerEls, { y: 0, opacity: 1, duration: 0.55, ease: 'power3.out', stagger: 0.08 }, panelAt + 0.3);
    openTlRef.current = tl;
    return tl;
  }, [position]);

  const playOpen = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const tl = buildOpenTimeline();
    if (!tl) { busyRef.current = false; return; }
    tl.eventCallback('onComplete', () => { busyRef.current = false; });
    tl.play(0);
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    closeTweenRef.current?.kill();
    closeTweenRef.current = gsap.to([...preLayerElsRef.current, panel], {
      xPercent: position === 'left' ? -100 : 100,
      duration: 0.32,
      ease: 'power3.in',
      overwrite: 'auto',
      onComplete: () => { busyRef.current = false; },
    });
  }, [position]);

  const animateIcon = useCallback((opening) => {
    spinTweenRef.current?.kill();
    spinTweenRef.current = gsap.to(iconRef.current, opening
      ? { rotate: 225, duration: 0.8, ease: 'power4.out', overwrite: 'auto' }
      : { rotate: 0, duration: 0.35, ease: 'power3.inOut', overwrite: 'auto' });
  }, []);

  const animateColor = useCallback((opening) => {
    colorTweenRef.current?.kill();
    colorTweenRef.current = gsap.to(toggleBtnRef.current, { color: opening ? openMenuButtonColor : menuButtonColor, delay: 0.18, duration: 0.3, ease: 'power2.out' });
  }, [openMenuButtonColor, menuButtonColor]);

  // "Menu" / "Close" label rolls through a few lines like a slot machine.
  const animateText = useCallback((opening) => {
    const inner = textInnerRef.current;
    if (!inner) return;
    textCycleAnimRef.current?.kill();
    const target = opening ? 'Close' : 'Menu';
    const seq = [opening ? 'Menu' : 'Close'];
    let last = seq[0];
    for (let i = 0; i < 3; i += 1) { last = last === 'Menu' ? 'Close' : 'Menu'; seq.push(last); }
    if (last !== target) seq.push(target);
    seq.push(target);
    setTextLines(seq);
    gsap.set(inner, { yPercent: 0 });
    textCycleAnimRef.current = gsap.to(inner, { yPercent: -((seq.length - 1) / seq.length) * 100, duration: 0.5 + seq.length * 0.07, ease: 'power4.out' });
  }, []);

  const setMenu = useCallback((target) => {
    if (openRef.current === target) return;
    openRef.current = target;
    setOpen(target);
    if (target) playOpen(); else playClose();
    animateIcon(target);
    animateColor(target);
    animateText(target);
  }, [playOpen, playClose, animateIcon, animateColor, animateText]);

  // Close when the route changes or the user clicks outside the panel.
  useEffect(() => { setMenu(false); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || toggleBtnRef.current?.contains(e.target)) return;
      setMenu(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, setMenu]);

  return (
    <div className="staggered-menu-wrapper fixed-wrapper" style={{ '--sm-accent': accentColor }} data-position={position} data-open={open || undefined}>
      <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
        {colors.slice(0, 3).map((c) => <div key={c} className="sm-prelayer" style={{ background: c }} />)}
      </div>
      <header className="staggered-menu-header">
        <button ref={toggleBtnRef} className="sm-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
          aria-controls="staggered-menu-panel" onClick={() => setMenu(!openRef.current)} type="button">
          <span className="sm-toggle-textWrap" aria-hidden="true">
            <span ref={textInnerRef} className="sm-toggle-textInner">
              {textLines.map((l, i) => <span className="sm-toggle-line" key={i}>{l}</span>)}
            </span>
          </span>
          <span ref={iconRef} className="sm-icon" aria-hidden="true">
            <span ref={plusHRef} className="sm-icon-line" />
            <span ref={plusVRef} className="sm-icon-line sm-icon-line-v" />
          </span>
        </button>
      </header>

      <aside id="staggered-menu-panel" ref={panelRef} className="staggered-menu-panel" aria-hidden={!open}>
        <div className="sm-panel-inner">
          <div className="sm-panel-kicker">Navigate</div>
          <ul className="sm-panel-list" data-numbering={displayItemNumbering || undefined}>
            {items.map((it) => (
              <li className="sm-panel-itemWrap" key={it.to}>
                <Link className={`sm-panel-item ${it.active ? 'is-active' : ''}`} to={it.to} tabIndex={open ? 0 : -1}>
                  <span className="sm-panel-itemLabel">
                    {it.label}
                    {it.badge ? <span className="sm-badge">{it.badge}</span> : null}
                  </span>
                </Link>
                {it.hint && <div className="sm-panel-hint">{it.hint}</div>}
              </li>
            ))}
          </ul>
          {footer && <div className="sm-footer">{footer}</div>}
        </div>
      </aside>
    </div>
  );
}
