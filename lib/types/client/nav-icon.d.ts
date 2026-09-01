/**
 * Official settings.section slot has no icon field (label/order/locale only).
 * Replace the gear only when one nav button owns the Usage label.
 */
export declare function recordsTouchSettingsNav(records: Iterable<MutationRecord>, labels?: ReadonlySet<string>): boolean;
/**
 * Watch the settings nav and keep the Usage glyph in place across re-renders.
 * The disposer disconnects observation, cancels one pending frame, and restores
 * every SVG changed by this installation. Missing DOM features leave the page untouched.
 */
export declare function installUsageNavIcon(): () => void;
//# sourceMappingURL=nav-icon.d.ts.map