---
name: Kinetic Ledger
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0b1c30'
  on-tertiary-container: '#75859d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
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
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  table-data:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 20px
  container-max: 1440px
---

## Brand & Style
The design system is engineered for the **ATS CLUB Inventory System**, focusing on high-density data management with zero friction. The brand personality is **reliable, efficient, and organized**, catering to both high-level administrators and operational members.

The visual style follows a **Corporate Modern** aesthetic with a lean toward **Minimalism**. It prioritizes clarity over decoration, using ample whitespace and a structured grid to reduce cognitive load. The emotional response should be one of control and precision—users should feel that the system is an extension of their workflow, not a barrier to it. High-contrast data tables and distinct functional zones ensure that information hierarchy is immediately apparent.

## Colors
The palette is anchored by **Deep Navy (Primary)** for institutional reliability and **Clear Blue (Secondary)** for interactive elements. 

- **Primary (#0F172A):** Used for navigation sidebars, primary headings, and high-level structural elements.
- **Secondary (#3B82F6):** Reserved for primary actions, links, and active states.
- **Neutral (#F8FAFC):** Applied to page backgrounds to allow card components to pop.
- **Status Colors:** Standardized across the system for immediate recognition. Approved items use Success Green; Pending items use Warning Amber; Overdue or Rejected items use Danger Red.
- **Role Indicators:** Admin views are accented with a subtle Indigo, while Member views remain neutral to focus on task completion.

## Typography
This design system utilizes **Inter** for its exceptional legibility in digital interfaces and data-heavy environments. **JetBrains Mono** is introduced sparingly for labels and ID tags to provide a technical, "ledger-like" feel that distinguishes metadata from body text.

- **Headlines:** Use tight letter-spacing and bold weights to establish a strong hierarchy.
- **Body Text:** Standardized at 14px for density without sacrificing readability.
- **Data Tables:** Use a specific 13px size to maximize the information visible on screen without requiring excessive scrolling.
- **Mobile Adjustments:** For mobile views, `display-lg` scales down to 24px (identical to `display-md`) to ensure headers do not wrap awkwardly.

## Layout & Spacing
The layout employs a **Fluid Grid** system based on a 12-column structure for desktop. 

- **Desktop (1280px+):** 24px margins, 20px gutters. Sidebar is fixed at 280px.
- **Tablet (768px - 1279px):** 16px margins, 16px gutters. Sidebar collapses to icons only.
- **Mobile (Below 768px):** 12px margins. Layout reflows to a single column.

The spacing rhythm is based on a **4px scale**. Use `md (16px)` for standard component internal padding and `lg (24px)` for outer container padding. This ensures a "breathable" interface even when data density is high.

## Elevation & Depth
Depth is achieved through **Tonal Layers** and **Ambient Shadows**. 

1. **Base Layer:** Background uses `neutral_color_hex`.
2. **Surface Layer:** White cards and containers sit atop the base.
3. **Elevation:** Instead of heavy borders, use a very soft, diffused shadow: `0px 4px 12px rgba(15, 23, 42, 0.05)`.
4. **Interaction:** On hover, cards should lift slightly with an increased shadow spread to provide tactile feedback.

This approach creates a clear physical metaphor where the "paper" (data cards) sits on the "desk" (system background).

## Shapes
The shape language is **Soft**, striking a balance between the rigidity of a professional tool and the approachability of modern software.

- **Standard Elements:** 0.25rem (4px) for input fields, checkboxes, and small buttons.
- **Cards & Containers:** 0.5rem (8px) for `rounded-lg`.
- **Status Pills:** Always use a fully rounded (pill) shape to distinguish them from interactive buttons.
- **Search Bars:** Should utilize `rounded-xl` (12px) to denote their status as a global utility.

## Components

### Buttons
- **Primary:** Solid `secondary_color_hex` with white text. No gradient.
- **Secondary:** Transparent background with a `tertiary_color_hex` border.
- **Action Icons:** 32x32px hit area with subtle hover backgrounds.

### Status Indicators (Pills)
Status tags must use high-contrast text on a low-opacity version of the status color (e.g., Success Green text on 10% opacity Green background). This ensures the tag is visible but does not distract from the primary data.

### Data Tables
- **Header:** Light grey background (`#F1F5F9`) with `label-sm` typography in all caps.
- **Rows:** 1px border-bottom for separation. Alternate row striping is not required due to the generous vertical padding (12px top/bottom per cell).
- **Alignment:** Numerical data should be right-aligned; text should be left-aligned.

### Inventory Cards
Used for Member views. Include a thumbnail placeholder, title, stock count, and a primary action button ("Request"). 

### Management Controls
Admin-specific controls (Delete, Edit, Audit) should be grouped in a "More" dropdown menu to prevent visual clutter in the main list view. Use high-contrast red only for the "Delete" action.

### Forms
Input fields use a 1px border in `tertiary_color_hex`. Focused states use a 2px `secondary_color_hex` border with no glow effect to maintain a clean aesthetic.