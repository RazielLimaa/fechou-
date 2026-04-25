import { z } from "zod";

export type BrazilianDocumentKind = "cpf" | "cnpj";

const CPF_CNPJ_INPUT_MAX_LENGTH = 24;
const CPF_CNPJ_ALLOWED_CHARS = /^[0-9.\-\/\s]+$/;

function digitAt(value: string, index: number) {
  return value.charCodeAt(index) - 48;
}

function hasOnlyRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

function isAllowedDocumentInput(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value).trim();
  return text.length > 0 && text.length <= CPF_CNPJ_INPUT_MAX_LENGTH && CPF_CNPJ_ALLOWED_CHARS.test(text);
}

export function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function isValidCpfDigits(cpf: string) {
  if (cpf.length !== 11 || hasOnlyRepeatedDigits(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += digitAt(cpf, i) * (10 - i);
  }
  let checkDigit = (sum * 10) % 11;
  if (checkDigit === 10) checkDigit = 0;
  if (checkDigit !== digitAt(cpf, 9)) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += digitAt(cpf, i) * (11 - i);
  }
  checkDigit = (sum * 10) % 11;
  if (checkDigit === 10) checkDigit = 0;

  return checkDigit === digitAt(cpf, 10);
}

function calculateCnpjDigit(base: string, weights: number[]) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) {
    sum += digitAt(base, i) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpjDigits(cnpj: string) {
  if (cnpj.length !== 14 || hasOnlyRepeatedDigits(cnpj)) return false;

  const firstDigit = calculateCnpjDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstDigit !== digitAt(cnpj, 12)) return false;

  const secondDigit = calculateCnpjDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondDigit === digitAt(cnpj, 13);
}

export function isValidCpf(value: unknown) {
  if (!isAllowedDocumentInput(value)) return false;
  return isValidCpfDigits(onlyDigits(value));
}

export function isValidCnpj(value: unknown) {
  if (!isAllowedDocumentInput(value)) return false;
  return isValidCnpjDigits(onlyDigits(value));
}

export function getCpfCnpjKind(value: unknown): BrazilianDocumentKind | null {
  if (!isAllowedDocumentInput(value)) return null;

  const digits = onlyDigits(value);
  if (isValidCpfDigits(digits)) return "cpf";
  if (isValidCnpjDigits(digits)) return "cnpj";
  return null;
}

export function isValidCpfOrCnpj(value: unknown) {
  return getCpfCnpjKind(value) !== null;
}

export function normalizeCpf(value: unknown) {
  return isValidCpf(value) ? onlyDigits(value) : null;
}

export function normalizeCnpj(value: unknown) {
  return isValidCnpj(value) ? onlyDigits(value) : null;
}

export function normalizeCpfCnpj(value: unknown) {
  return isValidCpfOrCnpj(value) ? onlyDigits(value) : null;
}

export function formatCpf(value: unknown) {
  const cpf = normalizeCpf(value);
  if (!cpf) return null;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function formatCnpj(value: unknown) {
  const cnpj = normalizeCnpj(value);
  if (!cnpj) return null;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function formatCpfCnpj(value: unknown) {
  const kind = getCpfCnpjKind(value);
  if (kind === "cpf") return formatCpf(value);
  if (kind === "cnpj") return formatCnpj(value);
  return null;
}

function blankStringToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function cpfCnpjBaseSchema(message: string) {
  return z
    .string({ invalid_type_error: message, required_error: message })
    .trim()
    .min(1, message)
    .max(CPF_CNPJ_INPUT_MAX_LENGTH, message)
    .refine((value) => CPF_CNPJ_ALLOWED_CHARS.test(value), message)
    .refine(isValidCpfOrCnpj, message);
}

export function cpfCnpjSchema(message = "CPF/CNPJ invalido.") {
  return cpfCnpjBaseSchema(message).transform((value) => formatCpfCnpj(value) ?? value);
}

export function cpfCnpjDigitsSchema(message = "CPF/CNPJ invalido.") {
  return cpfCnpjBaseSchema(message).transform((value) => normalizeCpfCnpj(value) ?? onlyDigits(value));
}

export function optionalCpfCnpjSchema(message = "CPF/CNPJ invalido.") {
  return z.preprocess(blankStringToUndefined, cpfCnpjSchema(message).optional());
}

export function optionalCpfCnpjDigitsSchema(message = "CPF/CNPJ invalido.") {
  return z.preprocess(blankStringToUndefined, cpfCnpjDigitsSchema(message).optional());
}
