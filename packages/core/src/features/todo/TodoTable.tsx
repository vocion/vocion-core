import { getTodoList } from '@/services/TodoService';
import { requireOrganization } from '@/utils/Auth';
import { TodoTableColumns } from './TodoTableColumns';

export const TodoTable = async () => {
  const { orgId } = await requireOrganization();

  const data = await getTodoList(orgId);

  return <TodoTableColumns data={data} />;
};
