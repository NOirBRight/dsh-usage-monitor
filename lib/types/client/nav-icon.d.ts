/** Official settings.section slot has no icon field (label/order/locale only).
 *  Swap the gear for the usage glyph. Missing nav buttons stay silent. */
export declare function recordsTouchSettingsNav(records: Iterable<MutationRecord>, labels?: ReadonlySet<string>): boolean;
/** Watch the settings nav and keep the Usage glyph in place across re-renders. */
export declare function installUsageNavIcon(): () => void;
//# sourceMappingURL=nav-icon.d.ts.map