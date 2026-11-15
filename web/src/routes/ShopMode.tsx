import { useParams } from 'react-router';
import { Placeholder } from '../components/Placeholder';

export function ShopMode() {
  const { id } = useParams();
  return <Placeholder title={`Shop Mode — store ${id ?? ''}`} phase="P1.5" />;
}
