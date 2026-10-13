declare module 'pdf-lib-internal/crypto' {
  import type { PDFDict } from '@cantoo/pdf-lib';
  /** Derives the file encryption key from the /Encrypt dictionary and a user or owner password. */
  export class CipherTransformFactory {
    constructor(dict: PDFDict, fileId: Uint8Array, password?: string);
    encryptionKey: Uint8Array;
  }
}
