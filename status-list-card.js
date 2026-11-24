/*
 * status-list-card: a titled list of coloured groups for Home Assistant wall
 * panels. Each group shows its active entities as rows (name + time since
 * the last change); the card hides itself when nothing is active.
 *
 * The card holds no house logic. A group's members come from an entity list,
 * a label or a group entity, and "active" is a list of states. See README.md
 * for the config reference.
 */

const VERSION = "0.1.1";

const DEFAULT_STATES = ["on", "open", "opening", "closing"];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "*" and "?" wildcards, anchored, case-insensitive.
function glob(pattern) {
  const re = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i");
}

// Minutes since a time, as "now", "12 min", "3 h", "2 d".
function ago(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(m >= 1)) return "now";
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
}

class StatusListCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.groups)) throw new Error("status-list-card: `groups` must be a list");
    this._cfg = config;
    this._config = config; // where card-mod/UIX look for a card's config
    this._sig = null;
    if (!this.shadowRoot) {
      // One ha-card for the card's lifetime, so styles that themes and
      // card-mod/UIX inject into it survive re-renders.
      this.attachShadow({ mode: "open" }).innerHTML = `<style>${STYLE}</style><ha-card></ha-card>`;
    }
    if (this._hass) this._render(true);
  }

  set hass(hass) {
    this._hass = hass;
    this._loadLabels(hass);
    this._render();
  }

  connectedCallback() {
    // Keep the "time ago" column fresh.
    this._timer = setInterval(() => this._render(), 30000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return this._rows || 1;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto" };
  }

  static getStubConfig() {
    return {
      title: "Open",
      icon: "mdi:alert",
      groups: [{ name: "Doors", icon: "mdi:door-open", colour: "#ff9a3c", label: "external_door" }],
    };
  }

  // Labels may be given by id or by name; map names to ids once.
  async _loadLabels(hass) {
    if (this._labels || this._labelsLoading) return;
    this._labelsLoading = true;
    try {
      const list = await hass.callWS({ type: "config/label_registry/list" });
      this._labels = {};
      for (const l of list) this._labels[String(l.name).toLowerCase()] = l.label_id;
    } catch (e) {
      this._labels = {};
    }
    this._render(true);
  }

  _labelId(label) {
    const key = String(label);
    return (this._labels && this._labels[key.toLowerCase()]) || key;
  }

  // Members of a group: { entity, name?, key? } items from `entities`,
  // `label` and `group`, filtered by `match` (labels and groups only).
  _members(hass, g) {
    const items = [];
    const seen = new Set();
    const add = (item) => {
      if (!item.entity || seen.has(item.entity)) return;
      seen.add(item.entity);
      items.push(item);
    };
    const match = g.match ? [].concat(g.match).map(glob) : null;
    const keep = (id) => !match || match.some((re) => re.test(id));
    for (const e of [].concat(g.entities || [])) add(typeof e === "string" ? { entity: e } : e);
    for (const label of [].concat(g.label || [])) {
      const id = this._labelId(label);
      for (const [eid, ent] of Object.entries(hass.entities || {})) {
        if ((ent.labels || []).includes(id) && keep(eid)) add({ entity: eid });
      }
    }
    for (const grp of [].concat(g.group || [])) {
      const st = hass.states[grp];
      for (const eid of (st && st.attributes.entity_id) || []) if (keep(eid)) add({ entity: eid });
    }
    return items;
  }

  _rowName(hass, g, item, st) {
    if (item.name) return item.name;
    if ((g.row_name || "entity") === "device") {
      const ent = hass.entities && hass.entities[item.entity];
      const dev = ent && ent.device_id && hass.devices && hass.devices[ent.device_id];
      if (dev) return dev.name_by_user || dev.name || item.entity;
    }
    return (st.attributes && st.attributes.friendly_name) || item.entity;
  }

  // The highlighted row: `highlight.rows` with {value} replaced by the
  // highlight entity's state, matched against each row's key (its entity id
  // unless the item gives `key`).
  _highlighter(hass) {
    const h = this._cfg.highlight;
    if (!h || !h.entity) return () => false;
    const st = hass.states[h.entity];
    const v = st && st.state;
    if (!v || ["unknown", "unavailable", ""].includes(v)) return () => false;
    const re = glob(String(h.rows || "{value}").replace(/\{value\}/g, v.replace(/[*?]/g, "")));
    return (key) => re.test(key);
  }

  _html(hass) {
    const cfg = this._cfg;
    const lit = this._highlighter(hass);
    const sections = [];
    let rows = 0;
    for (const g of cfg.groups) {
      const states = [].concat(g.states || DEFAULT_STATES).map(String);
      const active = [];
      for (const item of this._members(hass, g)) {
        const st = hass.states[item.entity];
        if (!st || !states.includes(st.state)) continue;
        active.push({ name: this._rowName(hass, g, item, st), since: st.last_changed, key: item.key || item.entity });
      }
      if (!active.length) continue;
      active.sort((a, b) => a.name.localeCompare(b.name));
      rows += active.length + 1;
      const colour = g.colour || "#9e9e9e";
      const list = active
        .map((r) => {
          const name = lit(r.key) ? `<b>${esc(r.name)}</b>` : esc(r.name);
          return `<div class="row"><span>${name}</span><span class="ago">${esc(ago(r.since))}</span></div>`;
        })
        .join("");
      sections.push(
        `<div class="group" style="--c:${esc(colour)}"><div class="gh"><div class="chip"><ha-icon icon="${esc(g.icon || "mdi:circle-medium")}"></ha-icon></div><div class="gn">${esc(g.name || "")}</div><div class="count">${active.length}</div></div>${list}</div>`
      );
    }
    this._rows = rows;
    if (!sections.length) return "";
    const head = `<div class="head"><div class="hc" style="background:${esc(cfg.icon_colour || "#ffc107")};color:${esc(cfg.icon_text_colour || "#1c1d21")}"><ha-icon icon="${esc(cfg.icon || "mdi:alert")}"></ha-icon></div><div class="title">${esc(cfg.title || "")}</div></div>`;
    return `<div class="panel">${head}${sections.join("")}</div>`;
  }

  _render(force) {
    const hass = this._hass;
    if (!hass || !this.shadowRoot || !this._cfg) return;
    let html;
    try {
      html = this._html(hass);
    } catch (e) {
      console.warn("status-list-card:", e);
      html = "";
    }
    const empty = html === "";
    const background = this._cfg.background || "panel";
    const sig = `${background}|${html}`;
    if (!force && sig === this._sig) return;
    this._sig = sig;
    const card = this.shadowRoot.querySelector("ha-card");
    card.className = background === "card" ? "card" : "panel";
    card.innerHTML = html;
    // Hide the whole card (and its grid slot) when nothing is active.
    if (this._cfg.hide_when_empty !== false && this.hidden !== empty) {
      this.hidden = empty;
      this.dispatchEvent(new CustomEvent("card-visibility-changed", { detail: { value: !empty }, bubbles: true, composed: true }));
    }
  }
}

const STYLE = `
:host { display: block; }
:host([hidden]) { display: none; }
ha-card {
  color: var(--status-list-text-color, #eaebee);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.65);
  font-family: var(--ha-font-family-body, inherit);
}
/* panel: no card chrome; the list sits on its own dark glass panel. */
ha-card.panel { background: none !important; border: none !important; box-shadow: none !important; backdrop-filter: none !important; }
ha-card.panel::before, ha-card.panel::after { display: none !important; }
ha-card.panel .panel {
  padding: 12px 14px; border-radius: 16px;
  background: var(--status-list-panel-background, rgba(28, 28, 34, 0.78));
  border: 1px solid var(--status-list-panel-border, rgba(255, 255, 255, 0.10));
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
/* card: the theme's normal card background. */
ha-card.card .panel { padding: 12px 14px; }
ha-icon { display: flex; line-height: 0; }
.head { display: flex; align-items: center; gap: 10px; }
.hc { width: 32px; height: 32px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center; flex: none; --mdc-icon-size: 21px; }
.title { font-size: 16px; font-weight: 500; }
.group { border-top: 0.5px solid rgba(255, 255, 255, 0.14); padding-top: 8px; margin-top: 8px;
  --fg: color-mix(in srgb, var(--c) 88%, white); --bg: color-mix(in srgb, var(--c) 30%, transparent); }
.gh { display: flex; align-items: center; gap: 8px; }
.chip { width: 28px; height: 28px; border-radius: 8px; background: var(--bg); color: var(--fg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; flex: none; --mdc-icon-size: 17px; }
.gn { flex: 1; font-size: 15px; font-weight: 500; color: var(--fg); }
.count { min-width: 28px; height: 28px; padding: 0 6px; box-sizing: border-box; border-radius: 8px; background: var(--bg); color: var(--fg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 500; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 5px 2px 5px 36px; font-size: 14px; }
.row b { color: var(--fg); font-weight: 600; }
.ago { color: rgba(234, 235, 238, 0.8); white-space: nowrap; }
`;

if (!customElements.get("status-list-card")) {
  customElements.define("status-list-card", StatusListCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "status-list-card",
    name: "Status list",
    description: "A titled list of coloured groups showing active entities and how long ago they changed.",
  });
  console.info(`%c STATUS-LIST-CARD %c ${VERSION} `, "background:#ffc107;color:#1c1d21", "");
}
