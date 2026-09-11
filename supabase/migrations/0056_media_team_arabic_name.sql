-- =============================================================================
-- 0056 — The Media team is "فريق التصوير" in Arabic.
--
-- The English name stays "Media"; only the Arabic reads differently, and so
-- does everything that mentions the team in Arabic: the Media Request and
-- its description, and the description of the permission to submit one.
-- =============================================================================

update teams
   set name_ar = 'التصوير'
 where key = 'MEDIA';

update request_types
   set name_ar        = 'طلب تصوير',
       description_ar = 'طلب تغطية فعالية أو إنتاج محتوى من فريق التصوير.'
 where key = 'media_request';

update permissions
   set description_ar = 'طلب تغطية أو محتوى من فريق التصوير'
 where key = 'media_requests.submit';
