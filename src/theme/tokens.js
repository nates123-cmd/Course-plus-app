// Token system — Course × Scribe merged, Direction B only. The var-map `t`
// resolves every key to `var(--*)` (see styles.css); theme switches by toggling
// [data-theme] on <html>, so no React re-render of styled nodes is needed.
//
// `t` carries BOTH the document-surface tokens (bg/card/accent…) and the
// work/status tokens (risk/good/area hues) so kit + screens read `t.*` exactly
// like the prototype's tk(dir, mode) return value.
export const FONT = "'Hanken Grotesk', sans-serif"

// Direction B font roles (the prototype's FONTS.B). Provided through context as
// `f` so ported component code (`const { t, f } = useApp()`) works verbatim.
export const FONTS = {
  B: {
    title: "'Hanken Grotesk', sans-serif", body: "'Hanken Grotesk', sans-serif",
    meta: "'Hanken Grotesk', sans-serif", ui: "'Hanken Grotesk', sans-serif",
    titleW: 600, titleSpacing: '-0.02em', uiSpacing: '0', mono: false,
    label: "'Hanken Grotesk', sans-serif", labelSpacing: '0.09em',
  },
}
export const F = FONTS.B

const v = (name) => `var(--${name})`

export const t = {
  bg: v('bg'), panel: v('panel'), card: v('card'), raise: v('raise'),
  line: v('line'), line2: v('line2'),
  t1: v('t1'), t2: v('t2'), t3: v('t3'),
  accent: v('accent'), onAccent: v('onAccent'),
  accentBg: v('accentBg'), accentLine: v('accentLine'),
  sel: v('sel'), tagBg: v('tagBg'), tagText: v('tagText'),
  shadow: v('shadow'),
  // work / status
  risk: v('risk'), riskBg: v('riskBg'), riskLine: v('riskLine'),
  good: v('good'), goodBg: v('goodBg'),
  area_arrow: v('area_arrow'), area_sds: v('area_sds'), area_brain: v('area_brain'),
  onArea: v('onArea'),
}
