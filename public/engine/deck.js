// Giao diện trình chiếu trực tiếp, dùng chung cho ứng dụng và bản HTML xuất ngoại tuyến.
import { computeTimeline, createPlayer, createPresenter, rich } from "./engine.js";

export async function mountDeck(root, project, opts = {}) {
  root.classList.add("mh-deck");
  root.innerHTML = `
    <div class="mh-host mh-deck-stage"></div>
    <div class="mh-deck-notes" hidden></div>
    <div class="mh-deck-bar">
      <button data-a="prev" title="Lùi (←)">‹</button>
      <span class="mh-deck-count"></span>
      <button data-a="next" title="Tiếp (→ hoặc Space)">›</button>
      <button data-a="notes" title="Ghi chú người nói (N)">📝</button>
      <button data-a="full" title="Toàn màn hình (F)">⛶</button>
      ${opts.onExit ? '<button data-a="exit" title="Thoát (Esc)">✕</button>' : ""}
    </div>`;
  const host = root.querySelector(".mh-deck-stage");
  const notes = root.querySelector(".mh-deck-notes");
  const count = root.querySelector(".mh-deck-count");
  const player = createPlayer(host, project, computeTimeline(project), { mode: "present", interactive: true });
  await player.ready();
  let scene = 0;
  // trình phát nhúng (YouTube) chiếm focus khi tải hoặc khi được bấm; phím chuyển trang cần lấy lại
  // (blur một khung không chuyển focus trên mọi trình duyệt: hãy focus vào bài trình chiếu)
  root.tabIndex = -1;
  const reclaimFocus = () => { if (document.activeElement?.tagName === "IFRAME") root.focus({ preventScroll: true }); };
  const pres = createPresenter(player, (s) => {
    scene = s.scene;
    count.textContent = `${s.scene + 1} / ${project.scenes.length}`;
    const n = project.scenes[s.scene]?.notes;
    notes.innerHTML = n ? `<b>Ghi chú:</b> ${rich(n)}` : "<i>Cảnh này chưa có ghi chú.</i>";
    reclaimFocus();
  });
  if (opts.startScene) pres.gotoScene(opts.startScene);
  for (const f of host.querySelectorAll("iframe")) f.addEventListener("load", () => setTimeout(reclaimFocus, 300));
  reclaimFocus();

  const act = {
    next: () => pres.next(),
    prev: () => pres.prev(),
    notes: () => { notes.hidden = !notes.hidden; },
    full: () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.()),
    exit: () => opts.onExit?.(),
  };
  // thanh trượt, nút và trình phát video trong trang chiếu giữ lại cú bấm và phím của riêng chúng
  // (thanh trượt: phím mũi tên; nút và video: Space / Enter); phím bút trình chiếu (PageUp/PageDown) luôn chuyển trang
  const inControl = (e) => !!e.target.closest?.(".mh-interactive");
  const ownsKey = (e) => inControl(e) && (e.target.tagName === "INPUT" ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"] : [" ", "Enter"]).includes(e.key);
  const onKey = (e) => {
    if (ownsKey(e)) return;
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); act.next(); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); act.prev(); }
    else if (e.key === "Home") pres.gotoScene(0);
    else if (e.key === "End") pres.gotoScene(project.scenes.length - 1);
    else if (e.key === "n" || e.key === "N") act.notes();
    else if (e.key === "f" || e.key === "F") act.full();
    else if (e.key === "Escape") act.exit();
  };
  root.querySelector(".mh-deck-bar").addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a) act[a]();
  });
  host.addEventListener("click", (e) => { if (!inControl(e)) (e.clientX < window.innerWidth * 0.25 ? act.prev : act.next)(); });
  let touchX = null;
  host.addEventListener("touchstart", (e) => { touchX = inControl(e) ? null : e.touches[0].clientX; }, { passive: true });
  host.addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) (dx < 0 ? act.next : act.prev)();
    touchX = null;
  });
  window.addEventListener("keydown", onKey);
  return {
    get scene() { return scene; },
    destroy() {
      window.removeEventListener("keydown", onKey);
      pres.destroy();
      player.destroy();
      root.innerHTML = "";
      root.classList.remove("mh-deck");
    },
  };
}
