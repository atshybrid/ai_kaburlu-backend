// Minimal ambient declaration for 'qrcode' to support production builds without @types installed
declare module 'qrcode' {
  const QRCode: any;
  export default QRCode;
}
