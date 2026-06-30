export async function onRequest(context) {
  const url = new URL(context.request.url);
  const hfPath = url.pathname.slice('/proxy-hf/'.length);
  if (!hfPath || hfPath.includes('..')) {
    return new Response('Invalid path', { status: 400 });
  }
  const hfUrl = `https://huggingface.co/${hfPath}${url.search}`;
  const upstream = await fetch(hfUrl, {
    signal: context.request.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'content-length': upstream.headers.get('content-length') || '',
      'cache-control': 'public, max-age=31536000',
      'accept-ranges': 'bytes',
    },
  });
}
