/** 同梱PNGをビルド時にdata URLへ変換する。 */
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
/** 同梱MP3を外部通信なしで再生する。 */
declare module "*.mp3" {
  const dataUrl: string;
  export default dataUrl;
}
