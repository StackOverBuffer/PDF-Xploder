declare module 'pdf-lib-internal/crypto' {
  import type { PDFDict } from '@cantoo/pdf-lib';
  /** Derives the file encryption key from the /Encrypt dictionary and a user or owner password. */
  export class CipherTransformFactory {
    constructor(dict: PDFDict, fileId: Uint8Array, password?: string);
    encryptionKey: Uint8Array;
    /** Decrypts one object's strings (and, with /StrF swapped, a stream's bytes). */
    createCipherTransform(num: number, gen: number): { decryptBytes(d: Uint8Array): Uint8Array };
  }
}
