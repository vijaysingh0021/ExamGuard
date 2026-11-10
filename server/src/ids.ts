import { z } from 'zod';

const uuid = z.string().uuid();

export const isUuid = (value: unknown): value is string => uuid.safeParse(value).success;