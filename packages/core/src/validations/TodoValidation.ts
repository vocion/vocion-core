import * as z from 'zod';

export const TodoValidation = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
});

export type TodoInput = z.infer<typeof TodoValidation>;

export const TodoIdValidation = z.coerce.number().positive();

export const EditTodoValidation = z.object({
  id: z.coerce.number(),
  title: z.string().min(1),
  message: z.string().min(1),
});

export type EditTodoInput = z.infer<typeof EditTodoValidation>;

export const DeleteTodoValidation = z.object({
  id: z.coerce.number(),
});
