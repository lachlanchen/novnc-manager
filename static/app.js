const state = {
  sessions: [],
  selectedId: null,
  carouselIndex: 0,
  carouselPreviewTimer: null,
  previewLoadToken: 0,
  refreshing: false,
  timer: null,
};

const elements = {
  list: document.querySelector("#session-list"),
  empty: document.querySelector("#empty-state"),
  search: document.querySelector("#search"),
  autoRefresh: document.querySelector("#auto-refresh"),
  refresh: document.querySelector("#refresh"),
  scanStatus: document.querySelector("#scan-status"),
  total: document.querySelector("#total-count"),
  online: document.querySelector("#online-count"),
  degraded: document.querySelector("#degraded-count"),
  visible: document.querySelector("#visible-count"),
  previewTitle: document.querySelector("#preview-title"),
  previewSubtitle: document.querySelector("#preview-subtitle"),
  previewPurpose: document.querySelector("#preview-purpose"),
  previewFrame: document.querySelector("#preview-frame"),
  previewPlaceholder: document.querySelector("#preview-placeholder"),
  previewMeta: document.querySelector("#preview-meta"),
  reloadPreview: document.querySelector("#reload-preview"),
  openPreview: document.querySelector("#open-preview"),
  detailsDialog: document.querySelector("#details-dialog"),
  detailsTitle: document.querySelector("#details-title"),
  detailsPurpose: document.querySelector("#details-purpose"),
  detailsList: document.querySelector("#details-list"),
  toast: document.querySelector("#toast"),
  themeChoices: [...document.querySelectorAll("[data-theme-choice]")],
  workspace: document.querySelector("#workspace"),
  viewChoices: [...document.querySelectorAll("[data-view-choice]")],
  carouselNav: document.querySelector("#carousel-nav"),
  carouselPrevious: document.querySelector("#carousel-previous"),
  carouselNext: document.querySelector("#carousel-next"),
  carouselPosition: document.querySelector("#carousel-position"),
};

function setTheme(theme) {
  const selected = ["vivid", "bright", "calm"].includes(theme) ? theme : "vivid";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("novnc-manager-theme", selected);
  for (const button of elements.themeChoices) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.themeChoice === selected ? "true" : "false",
    );
  }
}

function setView(view) {
  const selected = ["grid", "carousel", "focus"].includes(view) ? view : "grid";
  elements.workspace.classList.toggle("grid-mode", selected === "grid");
  elements.workspace.classList.toggle("carousel-mode", selected === "carousel");
  elements.carouselNav.hidden = selected !== "carousel";
  localStorage.setItem("novnc-manager-view", selected);
  for (const button of elements.viewChoices) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.viewChoice === selected ? "true" : "false",
    );
  }
  if (selected !== "carousel") {
    clearTimeout(state.carouselPreviewTimer);
    state.carouselPreviewTimer = null;
  }
  if (selected === "carousel") {
    requestAnimationFrame(() => {
      const cards = [...elements.list.querySelectorAll(".session-card")];
      if (cards.length) {
        state.carouselIndex = Math.min(state.carouselIndex, cards.length - 1);
        cards[state.carouselIndex].scrollIntoView({
          behavior: "auto",
          inline: "center",
          block: "nearest",
        });
      }
      updateCarousel();
    });
  }
}

function formatUptime(seconds) {
  if (!seconds) return "just started";
  const units = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
  ];
  const output = [];
  let remaining = seconds;
  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (value) output.push(`${value}${label}`);
    remaining %= size;
    if (output.length === 2) break;
  }
  return output.join(" ") || `${Math.max(1, remaining)}s`;
}

function currentSession() {
  return state.sessions.find((session) => session.id === state.selectedId) || null;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function fact(text) {
  return node("span", "fact", text);
}

function previewInfo(label, value, options = {}) {
  const item = node(
    "div",
    `preview-meta-item${options.wide ? " wide" : ""}`,
  );
  const labelNode = node("span", "preview-meta-label", label);
  const valueNode = node(
    "span",
    `preview-meta-value${options.status ? ` status-${options.status}` : ""}`,
    value || "Not identified",
  );
  valueNode.title = value || "Not identified";
  item.append(labelNode, valueNode);
  return item;
}

function filteredSessions() {
  const query = elements.search.value.trim().toLowerCase();
  if (!query) return state.sessions;
  return state.sessions.filter((session) =>
    [
      session.name,
      session.purpose,
      session.source_path,
      session.source_detail,
      session.web_port,
      session.vnc_port,
      session.display,
      session.tmux_session,
      session.service,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function makeButton(label, action, id, primary = false) {
  const button = node("button", `mini-button${primary ? " primary" : ""}`, label);
  button.type = "button";
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderCards() {
  const sessions = filteredSessions();
  elements.visible.textContent = String(sessions.length);
  elements.list.replaceChildren();
  elements.empty.hidden = sessions.length !== 0;

  for (const session of sessions) {
    const card = node(
      "article",
      `session-card${session.id === state.selectedId ? " selected" : ""}`,
    );
    card.dataset.id = session.id;
    const body = node("div", "card-body");
    const heading = node("div", "card-heading");
    heading.append(node("span", `status-dot ${session.status}`));
    heading.append(node("h3", "", session.name));
    body.append(heading);
    body.append(node("p", "purpose", session.purpose));
    const facts = node("div", "facts");
    facts.append(fact(`WEB ${session.web_port}`));
    if (session.vnc_port) facts.append(fact(`VNC ${session.vnc_port}`));
    if (session.display) facts.append(fact(session.display));
    if (session.resolution) facts.append(fact(session.resolution));
    facts.append(fact(formatUptime(session.uptime_seconds)));
    body.append(facts);

    const actions = node("div", "card-actions");
    actions.append(makeButton("Preview", "preview", session.id, true));
    actions.append(makeButton("Open ↗", "open", session.id));
    actions.append(makeButton("Details", "details", session.id));
    card.append(body, actions);
    elements.list.append(card);
  }
  if (elements.workspace.classList.contains("carousel-mode")) {
    requestAnimationFrame(updateCarousel);
  }
}

function updateCarousel() {
  if (!elements.workspace.classList.contains("carousel-mode")) return;
  const cards = [...elements.list.querySelectorAll(".session-card")];
  if (!cards.length) {
    elements.carouselPosition.textContent = "0 / 0";
    return;
  }
  const listBox = elements.list.getBoundingClientRect();
  const center = listBox.left + listBox.width / 2;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  cards.forEach((card, index) => {
    const box = card.getBoundingClientRect();
    const distance = (box.left + box.width / 2 - center) / Math.max(box.width, 1);
    const absolute = Math.abs(distance);
    if (absolute < nearestDistance) {
      nearestDistance = absolute;
      nearestIndex = index;
    }
    const clamped = Math.max(-3, Math.min(3, distance));
    const rotation = clamped * -18;
    const activeScale = window.innerWidth <= 760 ? 1.05 : 1.16;
    const scale = Math.max(0.7, activeScale - absolute * 0.17);
    const depth = Math.min(190, absolute * 92);
    card.style.transform =
      `perspective(1100px) translateZ(${-depth}px) rotateY(${rotation}deg) scale(${scale})`;
    card.style.opacity = String(Math.max(0.38, 1 - absolute * 0.18));
    card.style.filter = `saturate(${Math.max(0.48, 1 - absolute * 0.18)})`;
    card.style.zIndex = String(100 - Math.round(absolute * 10));
    card.classList.toggle("carousel-active", absolute < 0.48);
  });

  state.carouselIndex = nearestIndex;
  elements.carouselPosition.textContent = `${nearestIndex + 1} / ${cards.length}`;
  const activeId = cards[nearestIndex]?.dataset.id;
  scheduleCarouselPreview(
    state.sessions.find((session) => session.id === activeId),
  );
}

function moveCarousel(delta) {
  const cards = [...elements.list.querySelectorAll(".session-card")];
  if (!cards.length) return;
  state.carouselIndex = Math.max(
    0,
    Math.min(cards.length - 1, state.carouselIndex + delta),
  );
  cards[state.carouselIndex].scrollIntoView({
    behavior: "smooth",
    inline: "center",
    block: "nearest",
  });
}

function updatePreviewInformation(session) {
  if (!session) return;
  const status = session.status || "unknown";
  elements.previewTitle.textContent = session.name;
  elements.previewSubtitle.textContent =
    `${status} · web ${session.web_port} → VNC ${session.vnc_port || "unknown"}`;
  elements.previewPurpose.textContent = session.purpose || "";
  elements.previewPurpose.hidden = !session.purpose;
  elements.previewMeta.hidden = false;
  elements.previewMeta.replaceChildren(
    previewInfo("Status", status, { status }),
    previewInfo("Runtime", `Up ${formatUptime(session.uptime_seconds)}`),
    previewInfo("Web access", `127.0.0.1:${session.web_port}`),
    previewInfo(
      "VNC backend",
      `${session.vnc_host || "unknown"}:${session.vnc_port || "unknown"}`,
    ),
    previewInfo(
      "Desktop",
      [
        session.display ? `Display ${session.display}` : "Display unknown",
        session.resolution || "Resolution unknown",
      ].join(" · "),
    ),
    previewInfo(
      "Origin",
      [session.source_kind, session.source_detail].filter(Boolean).join(" · "),
    ),
    previewInfo("Project / launcher", session.source_path, { wide: true }),
  );
}

function renderPreview(session, options = {}) {
  if (!session) return;
  const { reload = false, rerender = false } = options;
  state.selectedId = session.id;
  updatePreviewInformation(session);
  elements.previewPlaceholder.hidden = true;
  elements.previewFrame.hidden = false;
  elements.reloadPreview.disabled = false;
  elements.openPreview.disabled = false;
  if (reload || elements.previewFrame.dataset.sessionId !== session.id) {
    const loadToken = ++state.previewLoadToken;
    elements.previewFrame.src = "about:blank";
    elements.previewFrame.dataset.sessionId = session.id;
    setTimeout(() => {
      if (
        loadToken !== state.previewLoadToken ||
        elements.previewFrame.dataset.sessionId !== session.id
      ) {
        return;
      }
      elements.previewFrame.src = session.preview_url;
    }, 0);
  }
  if (rerender) renderCards();
}

function scheduleCarouselPreview(session, immediate = false) {
  clearTimeout(state.carouselPreviewTimer);
  state.carouselPreviewTimer = null;
  if (!session) return;
  if (
    state.selectedId === session.id &&
    elements.previewFrame.dataset.sessionId === session.id
  ) {
    return;
  }
  const connect = () => {
    state.carouselPreviewTimer = null;
    if (!elements.workspace.classList.contains("carousel-mode")) return;
    const cards = [...elements.list.querySelectorAll(".session-card")];
    if (cards[state.carouselIndex]?.dataset.id !== session.id) return;
    renderPreview(session);
  };
  if (immediate) {
    connect();
  } else {
    state.carouselPreviewTimer = setTimeout(connect, 260);
  }
}

function selectPreview(session, reload = false) {
  if (!session) return;
  setView("focus");
  renderPreview(session, { reload, rerender: true });
}

function openSession(session) {
  if (!session) return;
  window.open(session.url, "_blank", "noopener");
}

function showDetails(session) {
  if (!session) return;
  elements.detailsTitle.textContent = session.name;
  elements.detailsPurpose.textContent = session.purpose;
  const details = [
    ["Status", session.status],
    ["noVNC URL", session.url],
    ["Web listener", `${session.web_host}:${session.web_port}`],
    ["VNC backend", `${session.vnc_host}:${session.vnc_port || "unknown"}`],
    ["X display", session.display || "unknown"],
    ["Resolution", session.resolution || "unknown"],
    ["Started from", `${session.source_kind}: ${session.source_detail}`],
    ["Project / launcher", session.source_path || "not identified"],
    ["tmux", session.tmux_session ? `${session.tmux_session}:${session.tmux_window}` : "not identified"],
    ["systemd", session.service || "not identified"],
    ["Web PID", String(session.web_pid)],
    ["VNC PID", session.vnc_pid ? String(session.vnc_pid) : "not identified"],
    ["Started", session.started_at || "unknown"],
    ["Command", session.command],
  ];
  elements.detailsList.replaceChildren();
  for (const [term, description] of details) {
    elements.detailsList.append(node("dt", "", term), node("dd", "", description));
  }
  elements.detailsDialog.showModal();
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  elements.refresh.disabled = true;
  elements.scanStatus.textContent = "Scanning local ports…";
  try {
    const response = await fetch("/api/instances", { cache: "no-store" });
    if (!response.ok) throw new Error(`Inventory request failed (${response.status})`);
    const data = await response.json();
    state.sessions = data.sessions || [];
    elements.total.textContent = String(data.counts?.total ?? state.sessions.length);
    elements.online.textContent = String(data.counts?.online ?? 0);
    elements.degraded.textContent = String(
      (data.counts?.degraded ?? 0) + (data.counts?.offline ?? 0),
    );
    const scanned = new Date(data.scanned_at);
    elements.scanStatus.textContent = `Live · ${scanned.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;
    renderCards();
    const selected = currentSession();
    if (selected) {
      updatePreviewInformation(selected);
    }
  } catch (error) {
    elements.scanStatus.textContent = "Inventory unavailable";
    showToast(error.message);
  } finally {
    state.refreshing = false;
    elements.refresh.disabled = false;
  }
}

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest(".session-card");
  const id = button?.dataset.id || card?.dataset.id;
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  if (!button && elements.workspace.classList.contains("carousel-mode")) {
    const cards = [...elements.list.querySelectorAll(".session-card")];
    const index = cards.indexOf(card);
    if (index >= 0) {
      state.carouselIndex = index;
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      renderPreview(session);
    }
    return;
  }
  const action = button?.dataset.action || "preview";
  if (action === "preview") {
    if (elements.workspace.classList.contains("carousel-mode")) {
      const cards = [...elements.list.querySelectorAll(".session-card")];
      const index = cards.indexOf(card);
      if (index >= 0) {
        state.carouselIndex = index;
        card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
      renderPreview(session);
    } else {
      selectPreview(session);
    }
  }
  if (action === "open") openSession(session);
  if (action === "details") showDetails(session);
});

elements.search.addEventListener("input", renderCards);
elements.list.addEventListener("scroll", () => requestAnimationFrame(updateCarousel), {
  passive: true,
});
elements.list.addEventListener(
  "wheel",
  (event) => {
    if (!elements.workspace.classList.contains("carousel-mode")) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    elements.list.scrollBy({ left: event.deltaY * 1.25, behavior: "smooth" });
  },
  { passive: false },
);
elements.refresh.addEventListener("click", refresh);
elements.reloadPreview.addEventListener("click", () =>
  renderPreview(currentSession(), { reload: true }),
);
elements.openPreview.addEventListener("click", () => openSession(currentSession()));
elements.autoRefresh.addEventListener("change", () => {
  clearInterval(state.timer);
  state.timer = elements.autoRefresh.checked ? setInterval(refresh, 10000) : null;
});
for (const button of elements.themeChoices) {
  button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
}
for (const button of elements.viewChoices) {
  button.addEventListener("click", () => setView(button.dataset.viewChoice));
}
elements.carouselPrevious.addEventListener("click", () => moveCarousel(-1));
elements.carouselNext.addEventListener("click", () => moveCarousel(1));
document.addEventListener("keydown", (event) => {
  if (!elements.workspace.classList.contains("carousel-mode")) return;
  if (event.key === "ArrowLeft") moveCarousel(-1);
  if (event.key === "ArrowRight") moveCarousel(1);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && elements.autoRefresh.checked) refresh();
});

const startupParameters = new URLSearchParams(window.location.search);
setTheme(
  startupParameters.get("theme") ||
    localStorage.getItem("novnc-manager-theme") ||
    "vivid",
);
setView(
  startupParameters.get("view") ||
    localStorage.getItem("novnc-manager-view") ||
    "grid",
);
refresh();
state.timer = setInterval(refresh, 10000);
