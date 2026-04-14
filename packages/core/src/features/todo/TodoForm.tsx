import type { SubmitHandler } from 'react-hook-form';
import type { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TodoValidation } from '@/validations/TodoValidation';

export const TodoForm = (props: {
  defaultValues?: z.infer<typeof TodoValidation>;
  onValid: SubmitHandler<z.infer<typeof TodoValidation>>;
}) => {
  const form = useForm<z.infer<typeof TodoValidation>>({
    resolver: zodResolver(TodoValidation),
    defaultValues: props.defaultValues ?? {
      title: '',
      message: '',
    }, // defaultValues needs to be defined to avoid warning: "A component is changing an uncontrolled input to be controlled"
  });

  const handleCreate = form.handleSubmit(props.onValid);
  const t = useTranslations('TodoForm');

  return (
    <Form {...form}>
      <form onSubmit={handleCreate} className="space-y-8">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('title_label')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>{t('title_description')}</FormDescription>
              <FormMessage errorMessage={t('title_error_message')} />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('message_title')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>{t('message_description')}</FormDescription>
              <FormMessage errorMessage={t('message_error_message')} />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('submit_button')}
        </Button>
      </form>
    </Form>
  );
};
