-- Additive, isolated schema. No existing Platform/KMS tables are changed.
begin;
create schema friend_time_private;
revoke all on schema friend_time_private from public, anon, authenticated;
create table friend_time_private.events (
 id uuid primary key,
 admin_hash text not null,
 member_keys jsonb not null default '{}'::jsonb,
 doc jsonb not null,
 created_at timestamptz not null default now()
);
alter table friend_time_private.events enable row level security;
revoke all on friend_time_private.events from public, anon, authenticated;

create function friend_time_private.check_slots(slots jsonb, kind text) returns void
language plpgsql set search_path = '' as $$
declare s text; d date;
begin
 if slots is null or jsonb_typeof(slots) <> 'array' then raise exception '請提供候選時間。'; end if;
 if jsonb_array_length(slots) not between 1 and 366 then raise exception '候選時間須為 1–366 個。'; end if;
 if (select count(*) <> count(distinct value) from jsonb_array_elements_text(slots)) then raise exception '候選時間重複。'; end if;
 for s in select jsonb_array_elements_text(slots) loop
  if s !~ '^\d{4}-\d{2}-\d{2}_(lunch|dinner|day)$' then raise exception '日期格式錯誤。'; end if;
  d:=split_part(s,'_',1)::date;
  if to_char(d,'YYYY-MM-DD') <> split_part(s,'_',1) or d < (now() at time zone 'Asia/Taipei')::date or d > (now() at time zone 'Asia/Taipei')::date+730 then raise exception '請選擇今天起兩年內的日期。'; end if;
  if (kind='class' and split_part(s,'_',2)<>'day') or (kind='meal' and split_part(s,'_',2) not in ('lunch','dinner')) then raise exception '時段與邀約類型不符。'; end if;
 end loop;
end $$;
revoke all on function friend_time_private.check_slots(jsonb,text) from public,anon,authenticated;

create function public.friend_time_api(p_action text, p_id uuid, p_token text default '', p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 r friend_time_private.events%rowtype; d jsonb; people jsonb; person jsonb; keys jsonb;
 token_hash text:=encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex');
 person_id text; host_id text; n text; slot text; t text; i integer; idx integer:=-1; times jsonb; answer jsonb; slots jsonb; is_admin boolean;
begin
 if p_id is null or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>100000 then raise exception '請求格式錯誤。'; end if;
 if p_action='create' then
  if length(coalesce(p_token,''))<64 then raise exception '管理憑證不完整。'; end if;
  select * into r from friend_time_private.events where id=p_id;
  if found then
   if r.admin_hash=token_hash then return r.doc; else raise exception '邀約識別碼已使用。'; end if;
  end if;
  if (select count(*) from friend_time_private.events where created_at>now()-interval '1 hour')>=300 then raise exception '目前建立次數較多，請稍後再試。'; end if;
  if length(trim(coalesce(p_data->>'title',''))) not between 1 and 80 or length(trim(coalesce(p_data->>'host',''))) not between 1 and 30 or coalesce(p_data->>'type','') not in ('meal','class') then raise exception '請確認邀約名稱、主揪名字與類型。'; end if;
  perform friend_time_private.check_slots(p_data->'slots',p_data->>'type');
  times:=p_data->'times';
  foreach t in array (case when p_data->>'type'='meal' then array['lunch','dinner'] else array['day'] end) loop
   if jsonb_typeof(times->t) is distinct from 'array' or jsonb_array_length(times->t)<>2 or coalesce(times->t->>0,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(times->t->>1,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (times->t->>0)>=(times->t->>1) then raise exception '請確認開始與結束時間。'; end if;
  end loop;
  if jsonb_typeof(p_data->'names') is distinct from 'array' or jsonb_array_length(p_data->'names')>59 then raise exception '最多可邀請 59 位朋友。'; end if;
  host_id:=gen_random_uuid()::text;
  select jsonb_object_agg(value,true) into answer from jsonb_array_elements_text(p_data->'slots');
  people:=jsonb_build_array(jsonb_build_object('id',host_id,'name',trim(p_data->>'host'),'submitted',true,'answers',answer));
  for n in select trim(value) from jsonb_array_elements_text(p_data->'names') loop
   if length(n) not between 1 and 30 then raise exception '名字須為 1–30 個字。'; end if;
   if exists(select 1 from jsonb_array_elements(people) v where lower(v->>'name')=lower(n)) then raise exception '名單中有重複名字。'; end if;
   people:=people||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'name',n,'submitted',false,'answers','{}'::jsonb));
  end loop;
  d:=jsonb_build_object('id',p_id,'title',trim(p_data->>'title'),'type',p_data->>'type','hostName',trim(p_data->>'host'),'hostId',host_id,'times',times,'slots',p_data->'slots','people',people,'rosterKnown',jsonb_array_length(p_data->'names')>0,'status','open','final',null);
  insert into friend_time_private.events(id,admin_hash,doc) values(p_id,token_hash,d);
  return d;
 end if;
 if p_action='get' then
  select doc into d from friend_time_private.events where id=p_id;
  if not found then raise exception '找不到邀約，請確認連結。'; end if;
  return d;
 end if;
 select * into r from friend_time_private.events where id=p_id for update;
 if not found then raise exception '找不到邀約，請確認連結。'; end if;
 d:=r.doc; keys:=r.member_keys; is_admin:=(r.admin_hash=token_hash and length(coalesce(p_token,''))>=64);
 if p_action='verify' then
  if is_admin or (length(coalesce(p_token,''))>=64 and keys->>(p_data->>'pid')=token_hash) then return jsonb_build_object('ok',true); end if;
  raise exception '此管理或修改連結無效。';
 end if;
 if p_action='respond' then
  if d->>'status'<>'open' then raise exception '邀約已關閉，無法修改。'; end if;
  person_id:=p_data->>'pid'; n:=trim(p_data->>'name'); answer:=p_data->'answers';
  if person_id is null or person_id !~ '^[a-f0-9-]{36}$' or length(coalesce(p_token,''))<64 or length(coalesce(n,'')) not between 1 and 30 or jsonb_typeof(answer) is distinct from 'object' then raise exception '回覆格式不完整。'; end if;
  if person_id=d->>'hostId' then raise exception '主揪時間由管理入口調整。'; end if;
  if exists(select 1 from jsonb_each(answer) where jsonb_typeof(value)<>'boolean' or not (d->'slots' ? key)) or (select count(*) from jsonb_each(answer))<>jsonb_array_length(d->'slots') then raise exception '候選時間已變更，請先按更新，再重新送出。'; end if;
  people:=d->'people';
  for i in 0..jsonb_array_length(people)-1 loop
   if people->i->>'id'=person_id then idx:=i; end if;
  end loop;
  if idx>=0 then
   person:=people->idx;
   if (person->>'submitted')::boolean and (keys->>person_id is distinct from token_hash) then raise exception '這個名字已有人填寫，請使用私人修改連結。'; end if;
   n:=person->>'name';
  else
   if jsonb_array_length(people)>=60 then raise exception '邀約最多支援 60 人。'; end if;
   if exists(select 1 from jsonb_array_elements(people) v where lower(v->>'name')=lower(n)) then raise exception '名字已存在，請從名單選擇或使用不同名字。'; end if;
   idx:=jsonb_array_length(people);
  end if;
  person:=jsonb_build_object('id',person_id,'name',n,'submitted',true,'answers',answer);
  people:=jsonb_set(people,array[idx::text],person,true);
  keys:=jsonb_set(keys,array[person_id],to_jsonb(token_hash),true);
  d:=jsonb_set(d,'{people}',people);
 elsif p_action in ('append','finalize','close','reopen') then
  if not is_admin then raise exception '需要有效的主揪管理連結。'; end if;
  if p_action='append' then
   if d->>'status'<>'open' then raise exception '請先重新開放邀約。'; end if;
   perform friend_time_private.check_slots(p_data->'slots',d->>'type');
   select jsonb_agg(s order by s) into slots from (select distinct value s from jsonb_array_elements_text((d->'slots')||(p_data->'slots'))) a;
   if jsonb_array_length(slots)>366 then raise exception '最多支援 366 個候選時段。'; end if;
   d:=jsonb_set(d,'{slots}',slots);
   people:=d->'people';
   for i in 0..jsonb_array_length(people)-1 loop
    if people->i->>'id'=d->>'hostId' then
     select jsonb_object_agg(value,true) into answer from jsonb_array_elements_text(slots);
     people:=jsonb_set(people,array[i::text,'answers'],answer);
    end if;
   end loop;
   d:=jsonb_set(d,'{people}',people);
  elsif p_action='finalize' then
   if d->>'status'<>'open' or not coalesce(d->'slots' ? (p_data->>'slot'),false) then raise exception '無法選定此時段。'; end if;
   d:=d||jsonb_build_object('status','final','final',p_data->>'slot');
  elsif p_action='close' then d:=d||jsonb_build_object('status','closed','final',null);
  elsif p_action='reopen' then d:=d||jsonb_build_object('status','open','final',null);
  end if;
 else raise exception '不支援此操作。';
 end if;
 update friend_time_private.events set doc=d, member_keys=keys where id=p_id;
 return d;
end $$;
revoke all on function public.friend_time_api(text,uuid,text,jsonb) from public;
grant execute on function public.friend_time_api(text,uuid,text,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
