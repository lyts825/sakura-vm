// noVNC 1.7 exposes its ESM client at the package root; the upstream community
// types still name the previous lib/rfb entry point. The RFB API is unchanged.
declare module '@novnc/novnc' {
  export { default } from '@novnc/novnc/lib/rfb';
}
