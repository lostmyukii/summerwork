grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_family_parent(uuid) to authenticated;
grant execute on function public.can_access_student(uuid) to authenticated;
grant execute on function public.is_subject_tutor(uuid, text) to authenticated;
grant execute on function public.create_family_space(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
