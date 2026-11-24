# Status List Card

A titled list of coloured groups for Home Assistant wall panels: what's open,
who's at the door, what needs attention. Each group shows its active entities
as rows with the time since they changed, and the whole card disappears when
nothing is active.

The card holds no house logic. A group's members come from an entity list, a
label or a group entity, and "active" is a list of states. Anything cleverer
belongs in a Home Assistant helper.

## Install

HACS → custom repositories → add this repository's URL as a **Dashboard**
repository, then download it. HACS registers the dashboard resource.

## Config

```yaml
type: custom:status-list-card
title: Open
icon: mdi:alert
groups:
  - name: Driveway
    icon: mdi:gate-open
    colour: "#a87bff"
    entities: [cover.front_gate, cover.garage_door]
    states: [open, opening, closing]
  - name: Windows
    icon: mdi:window-open-variant
    colour: "#4aa3ff"
    label: window
  - name: Doors
    icon: mdi:door-open
    colour: "#ff9a3c"
    label: external_door
```

A camera-detection list, with rows named after the camera's device and the
row for the camera currently on screen in bold:

```yaml
type: custom:status-list-card
title: Detected
icon: mdi:cctv
highlight:
  entity: input_text.camera_on_screen          # its state, e.g. "front_gate"
  rows: "binary_sensor.{value}_*_detected"     # rows whose key matches are bold
groups:
  - name: Person
    icon: mdi:account
    colour: "#db4437"
    group: binary_sensor.outdoor_detections
    match: "*_person_detected"
    row_name: device
  - name: Animal
    icon: mdi:paw
    colour: "#a87bff"
    group: binary_sensor.outdoor_detections
    match: "*_animal_detected"
    row_name: device
```

### Card keys

| Key | Meaning |
| --- | --- |
| `title`, `icon` | Header text and icon. |
| `icon_colour`, `icon_text_colour` | Header chip colours (default `#ffc107` on `#1c1d21`). |
| `background` | `panel` (default): no card chrome, the list sits on its own dark glass panel. `card`: the theme's normal card. |
| `highlight` | `{ entity, rows }`. `rows` is a pattern (`*` wildcards) with `{value}` replaced by the entity's state; a row whose key matches is bold in its group colour. |
| `hide_when_empty` | Default `true`: the card and its grid slot disappear when no group has an active row. |
| `groups` | The groups, in display order. Empty groups are left out. |

### Group keys

| Key | Meaning |
| --- | --- |
| `name`, `icon`, `colour` | Group heading, chip icon and colour (any CSS colour). |
| `entities` | Entity ids, or `{ entity, name, key }` items. `name` overrides the row name; `key` is what `highlight` matches (default: the entity id). |
| `label` | A label id or name (or a list): every entity carrying it. |
| `group` | A group entity (or a list): its members. |
| `match` | `*` pattern (or list) that `label` and `group` members must match. |
| `states` | States that count as active. Default `[on, open, opening, closing]`. |
| `row_name` | `entity` (default, the friendly name) or `device` (the device's name). |

Rows are sorted by name. Times read `now`, `12 min`, `3 h`, `2 d` and refresh
every 30 seconds.

Styling follows the dashboard: override the panel with
`--status-list-panel-background`, `--status-list-panel-border` and the text
with `--status-list-text-color`.
