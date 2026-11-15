import { useParams } from 'react-router';
import { Placeholder } from '../components/Placeholder';

export function ItemDetail() {
  const { id } = useParams();
  return <Placeholder title={`Item ${id ?? ''}`} phase="P3" />;
}
