# Agent Note: Shared layout settings and desktop density

Status: implemented

English | [中文](2026-09-26-shared-layout-settings-and-desktop-density.zh.md)

## Problem

Layout preferences were split across General Settings and a conversation-specific page owned by the optional session-files plugin. Desktop users could not choose the large, medium, or small spacing density available on phones, and a composition without session files had no stable owner for a general Layout page.

## Decision

The Settings shell owns a peer Layout page beside General and declares `settings.layout.item`. Feature plugins contribute layout rows without owning the page: ui-theme contributes desktop density, phone density and font size, and Pure UI; ui-session-files contributes Files visibility and inline-diff expansion. General retains color appearance and desktop conversation font size.

Theme settings persist `desktopLayout` independently from `mobileLayout`; both accept `large`, `medium`, or `small` and default to `medium`. AppFrame publishes `data-desktop-layout` only on desktop and keeps `data-mobile-layout` only on phones. Desktop density changes inherited spacing variables for the three-column sidebar, Session header and tabs, and composer. It never publishes phone navigation owner parameters or selects the phone structure.

## Alternatives considered

**Keep the Layout page in ui-session-files.** Rejected because a general settings destination must not disappear when an optional file feature is absent, and theme rows must not depend on another feature plugin's implementation package.

**Reuse `mobileLayout` on every viewport.** Rejected because phone and desktop density are separate user choices. Reusing one persisted field would make changing one device overwrite the other.

**Change desktop density automatically at viewport thresholds.** Rejected because the requested large, medium, and small modes are explicit preferences. Width still selects desktop versus phone structure at 768px; it does not choose the user's desktop density.

## Verification

The settings-shell, ui-theme, ui-session-files, ui-layout, and ui-sidebar focused suites cover page registration and teardown, independent persistence, accessible controls, root attributes, and the unchanged desktop structure. The affected Client TypeScript projects and plugin bundles build successfully.

## Consequences

The `settings.layout.item` slot belongs to ui-settings, so every contributor remains optional and declaration-aware. Existing phone preferences retain their keys and behavior. The new desktop field adds one value to the durable `ui-theme` namespace and to memory-mode browser presentation storage. Density is presentation-only and adds no Session event or model-visible input.
