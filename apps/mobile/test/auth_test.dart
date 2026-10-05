import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starter/core/api.dart';
import 'package:starter/core/auth.dart';

import 'fake_api.dart';

/// A fresh container is what the app gets after a restart.
Future<ProviderContainer> start(FakeApi api) async {
  final container = ProviderContainer(overrides: api.overrides);
  addTearDown(container.dispose);
  await container.read(authProvider.future);
  return container;
}

Future<void> logIn(ProviderContainer container) =>
    container.read(authProvider.notifier).verifyCode('robin@example.com', '123456');

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('code login stores the session and sends it as bearer token', () async {
    final api = FakeApi();
    final container = await start(api);
    expect(container.read(authProvider).value, isNull);

    final auth = container.read(authProvider.notifier);
    await auth.requestCode('robin@example.com');
    await expectLater(auth.verifyCode('robin@example.com', '000000'), throwsA(isA<ApiException>()));
    await logIn(container);
    expect(container.read(authProvider).value?.email, 'robin@example.com');

    await auth.updateName('Robin');
    expect(api.requests.last.headers['authorization'], 'Bearer token-1');
    expect(container.read(authProvider).value?.name, 'Robin');
  });

  test('a restart keeps the login, also offline', () async {
    final api = FakeApi();
    await logIn(await start(api));

    api.online = false;
    final restarted = await start(api);
    expect(restarted.read(authProvider).value?.email, 'robin@example.com');
  });

  test('an expired session logs out', () async {
    final api = FakeApi();
    await logIn(await start(api));

    api.validToken = null;
    final restarted = await start(api);
    await restarted.read(authProvider.notifier).refresh();
    expect(restarted.read(authProvider).value, isNull);
    expect((await start(api)).read(authProvider).value, isNull);
  });

  test('a 401 logs out', () async {
    final api = FakeApi();
    final container = await start(api);
    await logIn(container);

    api.validToken = 'rotated';
    await expectLater(container.read(authProvider.notifier).updateName('X'), throwsA(isA<ApiException>()));
    expect(container.read(authProvider).value, isNull);
  });

  test('logout works offline', () async {
    final api = FakeApi();
    final container = await start(api);
    await logIn(container);

    api.online = false;
    await container.read(authProvider.notifier).logout();
    expect(container.read(authProvider).value, isNull);
    expect((await start(api)).read(authProvider).value, isNull);
  });
}
