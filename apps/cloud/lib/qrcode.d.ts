declare module 'qrcode' { const QRCode:{toString:(text:string,options:any)=>Promise<string>;toBuffer:(text:string,options:any)=>Promise<Uint8Array>};export default QRCode; }
