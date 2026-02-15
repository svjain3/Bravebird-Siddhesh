import ClientComponent from './ClientComponent';

export function generateStaticParams() {
    return [{ id: 'demo' }];
}

export default function JobDetailPage() {
    return <ClientComponent />;
}
