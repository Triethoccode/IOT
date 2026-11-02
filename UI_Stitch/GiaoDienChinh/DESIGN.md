---
name: AeroDry IoT
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3f4850'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#707881'
  outline-variant: '#bfc7d2'
  surface-tint: '#006398'
  primary: '#006194'
  on-primary: '#ffffff'
  primary-container: '#007bb9'
  on-primary-container: '#fdfcff'
  inverse-primary: '#93ccff'
  secondary: '#006e2d'
  on-secondary: '#ffffff'
  secondary-container: '#7cf994'
  on-secondary-container: '#007230'
  tertiary: '#4648d4'
  on-tertiary: '#ffffff'
  tertiary-container: '#6063ee'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#93ccff'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#7ffc97'
  secondary-fixed-dim: '#62df7d'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005320'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  telemetry-xl:
    fontFamily: JetBrains Mono
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 40px
  telemetry-md:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 20px
  telemetry-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  margin: 1.5rem
  gutter-desktop: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style
The design system reflects a refined, industrial-grade smart home and climate engineering aesthetic. It merges high-reliability telemetric utility with residential consumer polish. 

### Visual Narrative & Philosophy
- **Precision Engineering:** UI elements prioritize high legibility, real-time feedback, and clear operational states for environmental automation, convection cycles, and mechanical actuators.
- **Atmospheric Clarity:** Emphasizes light, airy negative space reminiscent of circulating clean air, paired with decisive industrial signal indicators.
- **Design Movement:** Clean Industrial Modernism with soft tactile accents. It avoids raw, abrasive brutalism in favor of structural clarity: crisp borders, low-diffusion ambient shadows, structural micro-grids, and illuminated telemetry nodes.
- **Target Audience:** Smart home homeowners, HVAC and climate-control automation specialists, and IoT hardware integrators operating across Vietnamese and international environments.

## Colors
The color architecture relies on functional environmental cues and standardized telemetry states, grounded on a cool, hygienic slate canvas.

### Palette Roles
- **Primary / Telemetry Link (`#0284C7` - Sky Blue):** Main interactive controls, MQTT active state, network triggers, and primary sensor focus.
- **Safe / Optimal Mode (`#16A34A` - Emerald Green):** Normal environmental balance, dry target reached, efficient operation, and nominal system health.
- **Convection / Motor Core (`#6366F1` - Indigo/Purple):** Actuator fan speed, heat pump states, auxiliary smart automation routines, and active air cycles.
- **Passing Shower / Warning (`#F59E0B` - Amber):** Transitory rain alerts (Mưa bóng mây), rising humidity thresholds, and non-blocking maintenance flags.
- **Severe Weather / Alarm (`#DC2626` - Crimson Red):** Heavy rain alarms, thermal cutoffs, sensor disconnects, and immediate emergency retract states.
- **Surface & Track Structure:**
  - Canvas Base: `#F8FAFC` (Slate 50)
  - Card/Container Surface: `#FFFFFF` (Pristine White)
  - Structural Dividing Lines: `#E2E8F0` (Slate 200)
  - Inactive Gauge Tracks / Wells: `#F1F5F9` (Slate 100)
  - Headings & Primary Readouts: `#1E293B` (Slate 800)
  - Secondary Telemetry & Labels: `#475569` (Slate 600)
  - De-emphasized Metadata / Unit Marks: `#94A3B8` (Slate 400)

## Typography
Typography is divided strictly between qualitative human-readable interfaces and precise, machine-parsed instrumentation readouts.

- **Human Narrative (Inter):** Applied across section headers, system alerts, device names, operational instructions, and Vietnamese localized text. Vietnamese diacritics maintain clear baseline alignments with appropriate line-height budgets.
- **Machine Readout (JetBrains Mono):** Dedicated to numerical telemetry, including ambient humidity percentage (`%RH`), convection fan RPM, ambient Celsius readouts, countdown timers, RSSI decibel ratings, and network socket addresses. Tabular numerical figures prevent visual jitter when streaming telemetry via MQTT/WebSockets.

## Layout & Spacing
The layout adheres to an engineering dashboard grid optimized for high-density sensor presentation without cognitive overload.

### Grid & Responsiveness
- **Desktop (12 Columns):** Side-docked persistent system navigation (fixed 260px) paired with a 12-column fluid grid. Module slots adhere to standard structural units (e.g., 3-col telemetry pods, 6-col climate charts, 3-col actuator dials).
- **Tablet (8 Columns):** Two-tier layout with collapsible navigation and 4-column aggregated status panels.
- **Mobile (4 Columns):** Single vertical stream with priority-ordered cards. Critical metrics (e.g., rain status, humidity, master cycle toggle) pin to the primary viewport; granular charts stack sequentially below.
- **Rhythm Rules:** All layout margins, gutters, and inner card paddings follow an 8-point base unit (`0.5rem` / `8px`), maintaining mathematical order across high-density telemetry blocks.

## Elevation & Depth
Depth conveys physical operational layers while preserving a light, technical profile. Heavy blur shadows are replaced with structural outlines and controlled ambient lighting.

- **Level 0 (Canvas Base):** Flat `#F8FAFC` background. Never receives drop shadows.
- **Level 1 (Telemetry Panels & Cards):** Pristine `#FFFFFF` base wrapped in a 1px solid `#E2E8F0` border. Shadow is restrained to a light ambient contact: `0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)`.
- **Level 2 (Active Actuator Panels & Dropdowns):** Subtle elevated lift with standard border `#E2E8F0` and `0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)`.
- **Level 3 (Modal Overlays / Emergency Alerts):** Solid white surface overlaying a 40% `#0F172A` scrim, supported by `0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.06)`.
- **Instrument Wells (Gauges & Sockets):** Inset treatment. Semi-circular tracks and progress wells use `#F1F5F9` surfaces with an inner border of `#E2E8F0`, creating the perception of physical embedded hardware modules.

## Shapes
The structural geometry balances hardware-like durability with smooth consumer interactions.

- **Card Containers:** Standardized at `rounded-2xl` (`1rem` / `16px`) to soften visual rigidity and demarcate modular hardware nodes clearly.
- **Interactive Controls:** Action buttons, input fields, and pill tags utilize `rounded-lg` (`0.5rem` / `8px`) for immediate affordance and technical structure.
- **Round Instrumentation:** Actuator dials, radial gauge caps, toggle knobs, and connection node dots maintain complete circularity (`rounded-full`).

## Components

### 1. Semi-Circular Radial Gauges
- **Structure:** 180° to 220° sweep radial arc.
- **Well Track:** 10px track thickness using background `#F1F5F9`.
- **Active Stroke:** Dynamic SVG gradient mapping directly to system states: `#0284C7` (Standard Dehumidification), `#16A34A` (Optimum Target Met), or `#DC2626` (Saturated / Extreme). Rounded line-caps.
- **Readout Core:** Centered display utilizing `telemetry-xl` in `JetBrains Mono` for live integers, supplemented below by `label-sm` in `Inter` (`slate-400`) denoting units (e.g., `% RH` or `°C`).

### 2. Digital Countdown Timers
- **Container:** Recessed pill or micro-card surfaced in `#F8FAFC` bordered with `#E2E8F0`.
- **Typography:** `JetBrains Mono`, medium weight, tracked strictly with monospace spacing.
- **Active State:** When drying or convection cycles run, numerals utilize tertiary `#6366F1` with an ultra-soft backlight aura: `text-shadow: 0 0 12px rgba(99, 102, 241, 0.35)`.
- **Idle State:** Numerals revert to `#94A3B8`.

### 3. High-Contrast Action Buttons
- **Primary Action (Engage Cycle):** Background `#0284C7`, text `#FFFFFF`, 0.5rem rounded corners. Hover transitions to `#0369A1` with an ambient glow: `0 4px 14px 0 rgba(2, 132, 199, 0.35)`. Active tap scales down to `0.98`.
- **Critical Action (Emergency Stop / Retract):** Background `#DC2626`, text `#FFFFFF`. Hover transitions to `#B91C1C` with `0 4px 14px 0 rgba(220, 38, 38, 0.3)`.
- **Secondary / Toggle Action:** Border 1px solid `#E2E8F0`, background `#FFFFFF`, text `#1E293B`. Hover state shifts border to `#CBD5E1` and surface to `#F8FAFC`.

### 4. Toggle Switches & Micro-Actuators
- **Switch Track:** Width 44px, height 24px, fully pill-shaped. Inactive background `#E2E8F0`; active background switches to `#0284C7` (standard) or `#6366F1` (fan automation).
- **Thumb:** Pure white (`#FFFFFF`) 20px circle, positioned 2px inset, elevated with a crisp contact drop shadow `0 1px 2px rgba(0,0,0,0.15)`.

### 5. Telemetry Cards & Metric Pods
- **Base Canvas:** Pristine `#FFFFFF`, 16px corner radius, 1px `#E2E8F0` border.
- **Card Header:** Flex row containing micro-icon, Vietnamese/English category title (`label-md`, `#475569`), and right-aligned status pill.
- **Status Pills:** Compact rounded-full chips with a 6px status dot.
  - *Sunny / Safe:* Text `#16A34A`, background `#DCFCE7`.
  - *Shower Risk:* Text `#D97706`, background `#FEF3C7`.
  - *Alarm:* Text `#DC2626`, background `#FEE2E2`.

### 6. Environmental Time-Series Charts
- **Plot Area:** Transparent fill overlaid with soft horizontal guide rules in `#F1F5F9`.
- **Data Series:** Crisp 2px spline curve. Real-time updates push without layout shifts.
- **Area Fill:** Vertical linear gradient beginning at series color with 15% opacity, fading out to 0% opacity at baseline.
- **Tooltips:** Pristine white micro-card (`#FFFFFF`), 1px solid `#E2E8F0`, shadow-md, presenting exact timestamp and sensor reading in `JetBrains Mono`.