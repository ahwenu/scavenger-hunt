/** 同梱PNGをビルド時にdata URLへ変換する。 */
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
