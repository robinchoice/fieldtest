import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:starter/core/api.dart';

/// Stands in for the auth routes of the Hono API. The code is always 123456.
class FakeApi {
  final requests = <http.Request>[];
  bool online = true;
  String? validToken;
  var user = {'id': 'u1', 'email': 'robin@example.com', 'name': 'robin'};

  late final client = MockClient((request) async {
    if (!online) throw http.ClientException('offline');
    requests.add(request);
    final loggedIn = validToken != null && request.headers['authorization'] == 'Bearer $validToken';
    switch ((request.method, request.url.path)) {
      case ('POST', '/api/v1/auth/code'):
        return _json({'ok': true});
      case ('POST', '/api/v1/auth/code/verify'):
        if (jsonDecode(request.body)['code'] != '123456') {
          return _json({'error': 'Der Code stimmt nicht oder ist abgelaufen.'}, 400);
        }
        validToken = 'token-1';
        return _json({'user': user, 'token': validToken});
      case ('GET', '/api/v1/auth/me'):
        return _json({'user': loggedIn ? user : null});
      case ('PATCH', '/api/v1/auth/me'):
        if (!loggedIn) return _json({'error': 'Nicht angemeldet'}, 401);
        user = {...user, 'name': jsonDecode(request.body)['name'] as String};
        return _json({'user': user});
      case ('POST', '/api/v1/auth/logout'):
        validToken = null;
        return _json({'ok': true});
    }
    return _json({'error': 'Nicht gefunden'}, 404);
  });

  late final overrides = [httpClientProvider.overrideWithValue(client)];
}

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
