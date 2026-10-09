export interface FieldError {
  field: string;
  message: string;
}

/** The single error shape returned by the API: { error: { code, message, fields[], details? } } */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: FieldError[] = [],
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        fields: this.fields,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
