import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send, Share2, Trash2, X } from 'lucide-react';
import { api } from './api';
import { Avatar } from './ui';

export type Post = {
  id: string; caption: string; mediaUrl: string; mediaType: string;
  location?: string; createdAt: string; liked?: boolean; saved?: boolean;
  _count: { likes: number; comments: number };
  likes?: { userId: string }[];
  author: { id: string; username: string; profile?: { displayName: string; avatarUrl?: string } };
};
type Comment = { id: string; body: string; createdAt: string; user: { username: string } };

export function PostCard({ post }: { post: Post }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [menu,setMenu]=useState(false);const [sharing,setSharing]=useState(false);
  const viewer=qc.getQueryData<{id:string}>(['me']);
  const conversations=useQuery<any[]>({queryKey:['conversations'],enabled:sharing,queryFn:async()=>(await api.get('/conversations')).data});
  const comments = useQuery<Comment[]>({ queryKey: ['comments', post.id], enabled: expanded,
    queryFn: async () => (await api.get(`/posts/${post.id}/comments`)).data });
  async function refresh() {
    await Promise.all(['feed', 'explore', 'profile', 'saved','post'].map(key => qc.invalidateQueries({ queryKey: [key] })));
  }
  async function toggle(kind: 'like' | 'save') {
    if (busy) return;
    setBusy(kind); setError('');
    try { await api.post(`/posts/${post.id}/${kind}`); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function comment(e: FormEvent) {
    e.preventDefault(); if (!body.trim() || busy) return;
    setBusy('comment'); setError('');
    try {
      await api.post(`/posts/${post.id}/comments`, { body: body.trim() });
      setBody(''); setExpanded(true);
      await qc.invalidateQueries({ queryKey: ['comments', post.id] }); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function share() {
    const url = `${window.location.origin}/post/${post.id}`;
    setNotice(''); setError('');
    try {
      if (navigator.share) await navigator.share({ title: `GLOOMI · @${post.author.username}`, text: post.caption, url });
      else { await navigator.clipboard.writeText(url); setNotice('Ссылка скопирована'); }
    } catch (e) { if ((e as Error).name !== 'AbortError') setError('Не удалось поделиться ссылкой.'); }
  }
  return <article className="post" id={`post-${post.id}`}>
    <div className="post-author"><Link className="post-identity" to={`/profile/${encodeURIComponent(post.author.username)}`}>
      <span className="avatar" style={{ width: 40, height: 40 }}>{post.author.profile?.avatarUrl
        ? <img src={post.author.profile.avatarUrl} alt="" /> : <b>{post.author.username[0]?.toUpperCase()}</b>}</span>
      <div><b>{post.author.username}</b><small>{post.location || post.author.profile?.displayName || 'GLOOMI'}</small></div>
      </Link><time className="post-date" dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</time><div className="post-menu-wrap"><button className="icon-control" aria-label="Действия с публикацией" aria-expanded={menu} onClick={()=>setMenu(!menu)}><MoreHorizontal size={19}/></button>{menu&&<div className="post-menu"><Link to={`/post/${post.id}`} onClick={()=>setMenu(false)}>Открыть публикацию</Link><button onClick={async()=>{setMenu(false);try{await navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}`);setNotice('Ссылка скопирована')}catch{setError('Не удалось скопировать ссылку.')}}}>Скопировать ссылку</button>{viewer?.id===post.author.id&&<button className="danger" disabled={!!busy} onClick={async()=>{if(!window.confirm('Удалить эту публикацию?'))return;setBusy('delete');try{await api.delete(`/posts/${post.id}`);setMenu(false);await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(null)}}}><Trash2 size={14}/>Удалить</button>}</div>}</div></div>
    {post.mediaType === 'VIDEO' ? <video className="post-media" src={post.mediaUrl} controls playsInline preload="metadata" />
      : <img className="post-media" src={post.mediaUrl} alt={post.caption || 'Публикация'} loading="lazy" />}
    <div className="post-actions">
      <button disabled={!!busy} aria-label="Нравится" aria-pressed={!!post.liked} onClick={() => void toggle('like')}><Heart fill={post.liked ? 'var(--purple)' : 'none'} /></button>
      <button aria-label="Комментарии" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><MessageCircle /></button>
      <button aria-label="Отправить другу" onClick={()=>setSharing(true)}><Send/></button><button aria-label="Поделиться" onClick={() => void share()}><Share2 size={20}/></button><span className="action-spacer" />
      <button disabled={!!busy} aria-label="Сохранить" aria-pressed={!!post.saved} onClick={() => void toggle('save')}><Bookmark fill={post.saved ? 'var(--purple)' : 'none'} /></button>
    </div>
    <div className="post-copy"><b>{post._count.likes.toLocaleString('ru-RU')} отметок «Нравится»</b>
      <p><Link to={`/profile/${post.author.username}`}><b>{post.author.username}</b></Link> {post.caption.split(/([#@][\p{L}\p{N}_.]+)/gu).map((part,index)=>part.startsWith('#')?<Link className="caption-tag" key={index} to={`/explore?q=${encodeURIComponent(part)}`}>{part}</Link>:part.startsWith('@')?<Link className="caption-tag" key={index} to={`/profile/${encodeURIComponent(part.slice(1))}`}>{part}</Link>:<span key={index}>{part}</span>)}</p>
      <button className="muted comment-link" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Скрыть комментарии' : `Все комментарии: ${post._count.comments}`}</button>
      {expanded && <div className="comments-list" aria-live="polite">
        {comments.isLoading && <p className="muted">Загружаем комментарии…</p>}
        {comments.isError && <p className="error">Не удалось загрузить комментарии. <button onClick={() => void comments.refetch()}>Повторить</button></p>}
        {comments.data?.length === 0 && <p className="muted">Начните разговор первым.</p>}
        {comments.data?.map(c => <p key={c.id}><Link to={`/profile/${c.user.username}`}><b>{c.user.username}</b></Link> {c.body}</p>)}
      </div>}
      <form className="comment-form" onSubmit={comment}><input aria-label="Текст комментария" value={body} onChange={e => setBody(e.target.value)} placeholder="Добавьте комментарий…" maxLength={2000} /><button disabled={!!busy || !body.trim()} aria-label="Отправить комментарий"><Send size={17} /></button></form>
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="muted" role="status">{notice}</p>}
    </div>
    {sharing&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSharing(false)}}><div className="people-dialog" role="dialog" aria-modal="true" aria-label="Отправить публикацию другу"><header><h2>Поделиться моментом</h2><button className="icon-control" aria-label="Закрыть" onClick={()=>setSharing(false)}><X/></button></header>{conversations.isLoading?<p className="muted">Загружаем диалоги…</p>:conversations.data?.length?conversations.data.map(conversation=>{const peer=conversation.members?.find((member:any)=>member.userId!==viewer?.id)?.user;return <button key={conversation.id} className="share-person" disabled={!!busy} onClick={async()=>{setBusy('share');try{await api.post(`/conversations/${conversation.id}/messages`,{body:`${post.caption.slice(0,300)}\n${window.location.origin}/post/${post.id}`});setSharing(false);setNotice('Публикация отправлена');await qc.invalidateQueries({queryKey:['conversations']})}catch(e){setError((e as Error).message)}finally{setBusy(null)}}}><Avatar name={peer?.username||'Чат'} src={peer?.profile?.avatarUrl}/><span>{peer?.username||'Диалог'}</span><Send size={16}/></button>}):<p className="muted">Начните диалог из профиля автора, чтобы отправить ему публикацию.</p>}{conversations.isError&&<button className="text-button" onClick={()=>void conversations.refetch()}>Повторить загрузку</button>}</div></div>}
  </article>;
}
