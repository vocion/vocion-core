import * as z from 'zod';

export const TodoValidation = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
});

export const EditTodoValidation = z.object({
  id: z.coerce.number(),
  title: z.string().min(1),
  message: z.string().min(1),
});

export const DeleteTodoValidation = z.object({
  id: z.coerce.number(),
});
