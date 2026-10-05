import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

final httpClientProvider = Provider((ref) => http.Client());
final apiProvider = Provider((ref) => Api(ref.watch(httpClientProvider), '$apiUrl/api/v1'));

class ApiException implements Exception {
  final int status;
  final String message;
  const ApiException(this.status, this.message);

  @override
  String toString() => message;
}

/// No response from the server (offline, timeout, DNS), safe to retry later.
class OfflineException implements Exception {
  const OfflineException();

  @override
  String toString() => 'Keine Verbindung zum Server';
}

/// JSON client for the Hono API. Native clients have no cookie jar and send
/// the session token as a bearer token.
class Api {
  final http.Client _client;
  final String _baseUrl;
  String? token;

  /// Called when the server rejects our session token.
  void Function()? onUnauthorized;

  Api(this._client, this._baseUrl);

  Future<dynamic> get(String path) => send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => send('POST', path, body);
  Future<dynamic> patch(String path, Object? body) => send('PATCH', path, body);
  Future<dynamic> delete(String path) => send('DELETE', path);

  Future<dynamic> send(String method, String path, [Object? body]) async {
    final auth = token;
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers['accept'] = 'application/json'
      ..headers['content-type'] = 'application/json';
    if (auth != null) request.headers['authorization'] = 'Bearer $auth';
    if (body != null) request.body = jsonEncode(body);

    final http.Response response;
    try {
      response = await http.Response.fromStream(await _client.send(request).timeout(const Duration(seconds: 20)));
    } catch (e) {
      debugPrint('API $method $path failed: $e');
      throw const OfflineException();
    }

    final text = utf8.decode(response.bodyBytes);
    if (response.statusCode >= 400) {
      if (response.statusCode == 401 && auth != null) onUnauthorized?.call();
      String message;
      try {
        message = (jsonDecode(text) as Map<String, dynamic>)['error'] as String;
      } catch (_) {
        message = 'Serverfehler (${response.statusCode})';
      }
      throw ApiException(response.statusCode, message);
    }
    return text.isEmpty ? null : jsonDecode(text);
  }
}
